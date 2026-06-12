#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
split_video_atoms.py — разбивает монолитные видео-атомы на кейсы через LLM.

Фазы:
  1. Дедубликация видео-атомов
  2. Перетранскрипция обрезанных видео через Groq → output/transcripts/
  3. LLM-сплит каждого транскрипта на кейсы (OpenRouter)
  4. Обновление atoms_clean.jsonl: видео-атомы → кейс-атомы

Запуск:
  python output/split_video_atoms.py             # все видео
  python output/split_video_atoms.py --limit 2   # тест на 2 видео
  python output/split_video_atoms.py --skip-retranscribe  # не перетранскрибировать
"""

import json, os, re, sys, subprocess, tempfile, time, requests, argparse
sys.stdout.reconfigure(encoding='utf-8')

GROQ_KEY       = os.environ.get("GROQ_API_KEY", "")
OR_KEY         = os.environ.get("OPENROUTER_API_KEY", "")
OR_MODEL       = "google/gemini-2.5-flash"
OR_URL         = "https://openrouter.ai/api/v1/chat/completions"
ATOMS_FILE     = "output/atoms_clean.jsonl"
TRANSCRIPTS_DIR = "output/transcripts"
LOG_FILE       = "output/split_video.log"
CHUNK_SEC      = 700
BITRATE        = "32k"
TRUNCATED_LEN  = 8000  # контент ровно 8000 — вероятно обрезан

SPLIT_PROMPT = """\
Ты — эксперт по диагностике автомобилей. Дана транскрипция видеоурока об анализе осциллограмм автоэлектрики.

Раздели транскрипцию на отдельные АТОМЫ знаний. Типы атомов:
- "case": конкретный диагностический случай — реальный автомобиль, симптом, ход диагностики, вывод
- "theory": теоретический блок — принципы работы, нормальные значения, методология
- "procedure": пошаговая инструкция — как выполнить тест/измерение

Правила:
- Минимум 3, максимум 15 атомов из одной лекции
- Каждый атом САМОДОСТАТОЧЕН — понятен без контекста всей лекции
- content: 150–400 слов, своими словами (осмысленный пересказ, не дословная цитата)
- Игнорируй вступления/прощания/рекламу курса ("подписывайтесь", "дорогие друзья")
- Если в транскрипте несколько разных автомобилей/случаев — каждый отдельный атом

Поле system — одно из: зажигание | питание | механика/ЦПГ | фазы ГРМ | датчики | электросхемы | общее

Верни ТОЛЬКО JSON-массив (без markdown-блоков, без комментариев):
[
  {{
    "atom_type": "case",
    "title": "Краткое название до 80 символов",
    "system": "зажигание",
    "symptoms": ["симптом 1", "симптом 2"],
    "vehicle": "Марка Модель или null",
    "verdict": "норма|неисправность|неизвестно",
    "content": "Подробный текст атома 150-400 слов"
  }}
]

ТРАНСКРИПЦИЯ УРОКА "{title}":
{transcript}
"""


def lp(msg, log=None):
    print(msg, flush=True)
    if log:
        log.write(msg + '\n')
        log.flush()


def load_atoms():
    return [json.loads(l) for l in open(ATOMS_FILE, encoding='utf-8')]


def save_atoms(atoms):
    with open(ATOMS_FILE, 'w', encoding='utf-8') as f:
        for a in atoms:
            f.write(json.dumps(a, ensure_ascii=False) + '\n')


def dedup_video_atoms(atoms, log):
    """Удаляет дубли видео-атомов (одно видео → один атом). Оставляет новее/длиннее."""
    seen_src = {}
    to_remove = set()
    for a in atoms:
        if not a.get('id', '').startswith('video_'):
            continue
        if a.get('source', {}).get('locator') != 'full_transcript':
            continue  # не трогаем кейс-атомы, только монолитные транскрипции
        src = a.get('source', {}).get('file', '')
        if not src:
            continue
        if src in seen_src:
            prev = seen_src[src]
            prev_len = len(prev.get('content', ''))
            cur_len  = len(a.get('content', ''))
            # оставляем атом с «чистым» ID (без «»)
            if '«' in prev.get('id', '') or prev_len < cur_len:
                to_remove.add(prev['id'])
                seen_src[src] = a
            else:
                to_remove.add(a['id'])
        else:
            seen_src[src] = a

    if to_remove:
        lp(f"Дедубликация: удаляем {len(to_remove)} дублей: {to_remove}", log)
        atoms = [a for a in atoms if a['id'] not in to_remove]
    return atoms


def get_duration(path):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", path],
        capture_output=True, text=True
    )
    try:
        return float(r.stdout.strip())
    except:
        return 0


def transcribe_groq(path, lp_fn):
    """Транскрибирует видео через Groq. Возвращает полный текст."""
    duration = get_duration(path)
    lp_fn(f"  Длительность: {duration/60:.1f} мин")
    texts = []
    with tempfile.TemporaryDirectory() as tmpdir:
        start, idx = 0, 0
        while start < duration:
            out = os.path.join(tmpdir, f"chunk_{idx:03d}.mp3")
            subprocess.run([
                "ffmpeg", "-i", path,
                "-ss", str(start), "-t", str(CHUNK_SEC),
                "-vn", "-acodec", "mp3", "-ar", "16000", "-ac", "1", "-ab", BITRATE,
                out, "-y", "-loglevel", "error"
            ], check=True)
            size_kb = os.path.getsize(out) // 1024
            lp_fn(f"  Чанк {idx+1}: {start/60:.0f}-{min(start+CHUNK_SEC,duration)/60:.0f} мин → {size_kb} KB")
            for attempt in range(1, 4):
                try:
                    with open(out, "rb") as f:
                        resp = requests.post(
                            "https://api.groq.com/openai/v1/audio/transcriptions",
                            headers={"Authorization": "Bearer " + GROQ_KEY},
                            files={"file": ("audio.mp3", f, "audio/mpeg")},
                            data={"model": "whisper-large-v3-turbo", "language": "ru", "response_format": "text"},
                            timeout=180,
                        )
                    if resp.status_code == 200:
                        lp_fn(f"    ✅ {len(resp.text)} символов")
                        texts.append(resp.text.strip())
                        break
                    elif resp.status_code == 429:
                        lp_fn(f"    ⏳ rate limit, жду 60с...")
                        time.sleep(60)
                    else:
                        raise Exception(f"HTTP {resp.status_code}: {resp.text[:200]}")
                except requests.exceptions.ConnectionError as e:
                    if attempt < 3:
                        lp_fn(f"    ⚠️ сетевая ошибка (попытка {attempt}/3), повтор...")
                        time.sleep(15)
                    else:
                        raise
            os.remove(out)
            start += CHUNK_SEC
            idx  += 1
    return " ".join(texts)


def llm_split(title, transcript, log):
    """Отправляет транскрипт в LLM, получает список кейс-атомов."""
    prompt = SPLIT_PROMPT.format(title=title, transcript=transcript[:40000])
    body = json.dumps({
        "model": OR_MODEL,
        "max_tokens": 8000,
        "temperature": 0.2,
        "messages": [{"role": "user", "content": prompt}]
    }).encode('utf-8')
    req = requests.post(OR_URL, data=body, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {OR_KEY}",
        "HTTP-Referer": "http://localhost",
        "X-Title": "AutoDiag-RAG"
    }, timeout=120)
    if req.status_code != 200:
        raise Exception(f"LLM HTTP {req.status_code}: {req.text[:300]}")
    raw = req.json()["choices"][0]["message"]["content"].strip()
    # убрать возможный markdown
    raw = re.sub(r'^```(?:json)?\s*', '', raw)
    raw = re.sub(r'\s*```$', '', raw)
    return json.loads(raw)


def make_case_id(parent_id, title, idx):
    slug = re.sub(r'[^а-яёА-ЯЁa-zA-Z0-9]+', '_', title)[:35].strip('_')
    return f"{parent_id[:25]}_{slug}_{idx:02d}"


def process_video(atom, retranscribe, log):
    vid_id = atom['id']
    title  = atom.get('title', vid_id)
    src    = atom.get('source', {}).get('file', '')
    content = atom.get('content', '')

    # Полный транскрипт — из файла или из атома
    transcript_path = os.path.join(TRANSCRIPTS_DIR, vid_id + '.txt')

    if os.path.exists(transcript_path):
        lp(f"  Транскрипт из файла: {transcript_path}", log)
        transcript = open(transcript_path, encoding='utf-8').read()
    elif retranscribe and len(content) >= TRUNCATED_LEN and os.path.isfile(src):
        lp(f"  Перетранскрибирую (обрезан на {TRUNCATED_LEN}): {os.path.basename(src)}", log)
        transcript = transcribe_groq(src, lambda m: lp(m, log))
        os.makedirs(TRANSCRIPTS_DIR, exist_ok=True)
        with open(transcript_path, 'w', encoding='utf-8') as f:
            f.write(transcript)
        lp(f"  Сохранён: {transcript_path} ({len(transcript)} символов)", log)
    else:
        transcript = content
        if len(transcript) >= TRUNCATED_LEN:
            lp(f"  ⚠️  Транскрипт обрезан, используем {len(transcript)} символов (--skip-retranscribe)", log)

    lp(f"  LLM-сплит ({len(transcript)} символов)...", log)
    cases = llm_split(title, transcript, log)
    lp(f"  Получено атомов: {len(cases)}", log)

    result = []
    for i, c in enumerate(cases):
        if not isinstance(c, dict):
            continue
        cid = make_case_id(vid_id, c.get('title', f'case_{i}'), i + 1)
        atom_out = {
            'id': cid,
            'atom_type': c.get('atom_type', 'case'),
            'title': c.get('title', ''),
            'system': c.get('system', 'общее'),
            'confidence': 'medium',
            'needs_human_review': True,
            'review_notes': f'LLM-сплит из {vid_id}',
            'content': c.get('content', ''),
            'source': {'file': atom.get('source', {}).get('file', ''), 'locator': f'llm_split:{vid_id}'},
        }
        if c.get('symptoms'):
            atom_out['symptoms'] = c['symptoms']
        if c.get('vehicle'):
            atom_out['vehicle'] = c['vehicle']
        if c.get('verdict'):
            atom_out['verdict'] = c['verdict']
        atom_out['dtc'] = []
        result.append(atom_out)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=0, help='Обработать только N видео (0=все)')
    parser.add_argument('--skip-retranscribe', action='store_true', help='Не перетранскрибировать обрезанные')
    args = parser.parse_args()

    os.makedirs(TRANSCRIPTS_DIR, exist_ok=True)
    log = open(LOG_FILE, 'a', encoding='utf-8')
    lp(f"\n=== split_video_atoms: {time.strftime('%Y-%m-%d %H:%M:%S')} ===", log)

    atoms = load_atoms()
    atoms = dedup_video_atoms(atoms, log)

    video_atoms = [a for a in atoms if a.get('id', '').startswith('video_')
                   and a.get('source', {}).get('locator') == 'full_transcript']
    lp(f"Видео-атомов для обработки: {len(video_atoms)}", log)

    if args.limit:
        video_atoms = video_atoms[:args.limit]
        lp(f"Лимит: {args.limit}", log)

    retranscribe = not args.skip_retranscribe
    processed = errors = 0
    new_case_atoms = []
    processed_video_ids = set()

    for i, vatom in enumerate(video_atoms):
        vid = vatom['id']
        lp(f"\n[{i+1}/{len(video_atoms)}] {vid}", log)
        try:
            cases = process_video(vatom, retranscribe, log)
            new_case_atoms.extend(cases)
            processed_video_ids.add(vid)
            processed += 1
            lp(f"  ✅ Создано {len(cases)} атомов", log)
            for c in cases:
                lp(f"    • {c['atom_type']:10} | {c['title'][:60]}", log)
        except Exception as e:
            import traceback
            lp(f"  ОШИБКА: {e}", log)
            lp(traceback.format_exc(), log)
            errors += 1

    # Обновляем atoms_clean.jsonl: убираем обработанные видео-атомы, добавляем кейсы
    atoms_updated = [a for a in atoms if a['id'] not in processed_video_ids]
    atoms_updated.extend(new_case_atoms)
    save_atoms(atoms_updated)

    lp(f"\n=== ИТОГ: обработано {processed} видео, ошибок {errors} ===", log)
    lp(f"Новых кейс-атомов: {len(new_case_atoms)}", log)
    lp(f"Всего атомов в базе: {len(atoms_updated)}", log)
    log.close()


if __name__ == "__main__":
    main()
