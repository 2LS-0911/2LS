#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Транскрипция видео через Groq Whisper API.
Конвертирует видео в 32kbps моно MP3, режет на куски по ~20 мин, отправляет на Groq.
"""
import json, os, re, sys, subprocess, tempfile, time
import requests
sys.stdout.reconfigure(encoding='utf-8')

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
ATOMS_FILE   = "output/atoms_clean.jsonl"
LOG_FILE     = "output/transcribe_groq.log"
CHUNK_SEC    = 700    # ~11 минут на чанк (~2.2 MB при 32kbps) — 4.6 MB таймаутит
BITRATE      = "32k"  # низкий битрейт для малого размера

COURSE_DIRS = [
    r"[freekurses.site] Анализ осциллограмм. Профессиональный поиск сложных дефектов (2025)",
    r"[freekurses.site] Книга автоэлектрика. Работа с электросхемами",
]

def video_atom_id(path):
    name = os.path.splitext(os.path.basename(path))[0]
    safe = re.sub(r'[^a-zA-Zа-яёА-ЯЁ0-9_]', '_', name)
    return f"video_{safe[:60]}"

def infer_title(filename):
    name = os.path.splitext(filename)[0]
    return re.sub(r'^[\d]+[\._\s]*', '', name).strip() or filename

def find_videos():
    videos = []
    for d in COURSE_DIRS:
        if not os.path.isdir(d): continue
        for root, _, files in os.walk(d):
            for f in sorted(files):
                if f.lower().endswith(('.mp4', '.m4v')):
                    videos.append(os.path.join(root, f))
    return sorted(videos)

def load_atoms():
    return [json.loads(l) for l in open(ATOMS_FILE, encoding='utf-8')]

def save_atoms(atoms):
    with open(ATOMS_FILE, 'w', encoding='utf-8') as f:
        for a in atoms:
            f.write(json.dumps(a, ensure_ascii=False) + '\n')

def already_done(atoms, path):
    aid = video_atom_id(path)
    return any(a.get('id') == aid and len(a.get('content', '')) > 100 for a in atoms)

def get_duration(path):
    """Возвращает длительность видео в секундах через ffprobe."""
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", path],
        capture_output=True, text=True
    )
    try:
        return float(result.stdout.strip())
    except:
        return 0

def extract_audio_chunks(video_path, tmpdir, lp):
    """Конвертирует видео в 32kbps MP3 и режет на чанки. Возвращает список путей."""
    duration = get_duration(video_path)
    lp(f"  Длительность: {duration/60:.1f} мин")

    chunks = []
    start = 0
    idx = 0
    while start < duration:
        out = os.path.join(tmpdir, f"chunk_{idx:03d}.mp3")
        cmd = [
            "ffmpeg", "-i", video_path,
            "-ss", str(start), "-t", str(CHUNK_SEC),
            "-vn", "-acodec", "mp3", "-ar", "16000", "-ac", "1", "-ab", BITRATE,
            out, "-y", "-loglevel", "error"
        ]
        subprocess.run(cmd, check=True)
        size_mb = os.path.getsize(out) / 1024**2
        lp(f"  Чанк {idx+1}: {start/60:.0f}-{min(start+CHUNK_SEC, duration)/60:.0f} мин → {size_mb:.1f} MB")
        chunks.append(out)
        start += CHUNK_SEC
        idx += 1
    return chunks

def transcribe_chunk(path, lp):
    """Транскрибирует один MP3-чанк через Groq. До 3 попыток при сетевой ошибке."""
    size_kb = os.path.getsize(path) // 1024
    lp(f"    → Groq: {size_kb} KB ...", )
    for attempt in range(1, 4):
        t0 = time.time()
        try:
            with open(path, "rb") as f:
                resp = requests.post(
                    "https://api.groq.com/openai/v1/audio/transcriptions",
                    headers={"Authorization": "Bearer " + GROQ_API_KEY},
                    files={"file": ("audio.mp3", f, "audio/mpeg")},
                    data={"model": "whisper-large-v3-turbo", "language": "ru", "response_format": "text"},
                    timeout=180,
                )
            elapsed = time.time() - t0
            if resp.status_code == 200:
                text = resp.text.strip()
                lp(f"    ✅ {len(text)} символов за {elapsed:.1f}с")
                return text
            elif resp.status_code == 429:
                wait = 60
                lp(f"    ⏳ Rate limit (попытка {attempt}/3), жду {wait}с...")
                time.sleep(wait)
            else:
                raise Exception(f"HTTP {resp.status_code}: {resp.text[:200]}")
        except requests.exceptions.ConnectionError as e:
            elapsed = time.time() - t0
            if attempt < 3:
                lp(f"    ⚠️ Сетевая ошибка (попытка {attempt}/3, {elapsed:.0f}с), повтор через 15с: {e}")
                time.sleep(15)
            else:
                raise
    raise Exception("Все 3 попытки провалились")

def main():
    log = open(LOG_FILE, 'a', encoding='utf-8')
    def lp(msg): print(msg, flush=True); log.write(msg + '\n'); log.flush()

    lp(f"\n=== Groq транскрипция: {time.strftime('%Y-%m-%d %H:%M:%S')} ===")

    videos = find_videos()
    atoms  = load_atoms()
    todo   = [v for v in videos if not already_done(atoms, v)]

    lp(f"Всего видео: {len(videos)}, готово: {len(videos)-len(todo)}, осталось: {len(todo)}")
    if not todo:
        lp("Все готово!")
        log.close()
        return

    for v in todo:
        lp(f"  ⏳ {os.path.basename(v)} ({os.path.getsize(v)//1024//1024} MB)")

    processed = errors = 0
    with tempfile.TemporaryDirectory() as tmpdir:
        for i, path in enumerate(todo):
            basename = os.path.basename(path)
            size_mb  = os.path.getsize(path) / 1024**2
            lp(f"\n[{i+1}/{len(todo)}] {basename} ({size_mb:.0f} MB)")
            t0 = time.time()
            try:
                chunks = extract_audio_chunks(path, tmpdir, lp)
                texts = []
                for j, chunk in enumerate(chunks):
                    lp(f"  Транскрибирую чанк {j+1}/{len(chunks)}:")
                    text = transcribe_chunk(chunk, lp)
                    texts.append(text)
                    os.remove(chunk)  # освобождаем место

                full_text = " ".join(texts)
                elapsed = time.time() - t0
                lp(f"  Итого: {len(full_text)} символов за {elapsed:.0f}с ({elapsed/60:.1f} мин)")

                aid   = video_atom_id(path)
                title = infer_title(basename)
                atom  = {
                    'id': aid, 'atom_type': 'theory', 'title': title,
                    'stage': 'review', 'confidence': 'medium',
                    'needs_human_review': True,
                    'review_notes': 'Groq Whisper транскрипция — требует разбивки на кейсы',
                    'system': 'общее', 'content': full_text[:8000],
                    'source': {'file': path, 'locator': 'full_transcript'},
                    'dtc': []
                }
                idx = next((j for j, a in enumerate(atoms) if a.get('id') == aid), None)
                if idx is not None:
                    atoms[idx] = atom
                else:
                    atoms.append(atom)
                save_atoms(atoms)
                processed += 1
                lp(f"  Атом сохранён: {aid}")

            except Exception as e:
                import traceback
                lp(f"  ОШИБКА: {e}")
                lp(traceback.format_exc())
                errors += 1

    lp(f"\n=== ИТОГ: обработано {processed}, ошибок {errors} ===")
    log.close()

if __name__ == "__main__":
    main()
