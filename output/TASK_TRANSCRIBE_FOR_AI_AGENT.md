# Задание: Транскрипция оставшихся видео через Groq Whisper API

## Контекст

Локальная транскрипция (faster-whisper large-v3, CPU) работает, но медленно — видео ЕР6 заняло 36545 секунд (~10 часов). Groq предоставляет бесплатный Whisper API с огромной скоростью (реальный фактор ~200x vs large-v3 CPU).

**Цель:** транскрибировать оставшиеся видео через Groq Whisper, не дожидаясь CPU-прогона.

## Жёсткие правила

1. СНАЧАЛА проверь какие видео уже готовы — не перетирай существующие атомы.
2. Groq ограничивает файлы 25 MB — большие видео нужно резать по 25 MB через ffmpeg.
3. Запускать из `C:\dia`.
4. Сохранять промежуточно после каждого видео.

---

## Часть A. Подготовка

### A.1 Проверить что уже готово

```powershell
python -c "
import json, sys
sys.stdout.reconfigure(encoding='utf-8')
atoms = [json.loads(l) for l in open('output/atoms_clean.jsonl', encoding='utf-8')]
done = [a['id'] for a in atoms if a.get('id','').startswith('video_') and len(a.get('content',''))>100]
print('Готово:', len(done))
for d in done: print(' ', d)
"
```

### A.2 Получить ключ Groq

1. Зайди на https://console.groq.com → API Keys → Create API Key
2. Бесплатный tier: 28 800 секунд аудио / день (~8 часов)
3. Запиши ключ: `gsk_...`

### A.3 Проверить наличие ffmpeg (для нарезки больших файлов)

```powershell
ffmpeg -version 2>&1 | Select-Object -First 1
```

Если нет: скачать с https://ffmpeg.org/download.html и добавить в PATH.

### A.4 Проверить размеры видео

```powershell
python -c "
import os, sys, json
sys.stdout.reconfigure(encoding='utf-8')

# Уже готовые
atoms = [json.loads(l) for l in open('output/atoms_clean.jsonl', encoding='utf-8')]
done_ids = set(a['id'] for a in atoms if a.get('id','').startswith('video_') and len(a.get('content',''))>100)

import re
def video_atom_id(path):
    name = os.path.splitext(os.path.basename(path))[0]
    safe = re.sub(r'[^a-zA-Zа-яА-Я0-9_]', '_', name)
    return f'video_{safe[:60]}'

dirs = [
    r'[freekurses.site] Анализ осциллограмм. Профессиональный поиск сложных дефектов (2025)',
    r'[freekurses.site] Книга автоэлектрика. Работа с электросхемами',
]
for d in dirs:
    for root, _, files in os.walk(d):
        for f in sorted(files):
            if f.lower().endswith(('.mp4','.m4v')):
                path = os.path.join(root, f)
                size_mb = os.path.getsize(path) / 1024**2
                aid = video_atom_id(path)
                status = '✅ готово' if aid in done_ids else f'⏳ {size_mb:.0f} MB'
                print(f'{status:15s} {f}')
"
```

---

## Часть B. Скрипт транскрипции через Groq

Создай файл `output/transcribe_groq.py`:

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Транскрипция видео через Groq Whisper API.
Groq бесплатный tier: 28800 сек аудио/день.
Лимит файла: 25 MB (большие режутся ffmpeg).
"""
import json, os, re, sys, subprocess, tempfile, time
sys.stdout.reconfigure(encoding='utf-8')

GROQ_API_KEY = "ВСТАВЬ_КЛЮЧ_СЮДА"  # gsk_...
ATOMS_FILE   = "output/atoms_clean.jsonl"
LOG_FILE     = "output/transcribe_groq.log"
MAX_MB       = 24  # чуть меньше 25 для запаса

COURSE_DIRS = [
    r"[freekurses.site] Анализ осциллограмм. Профессиональный поиск сложных дефектов (2025)",
    r"[freekurses.site] Книга автоэлектрика. Работа с электросхемами",
]

def video_atom_id(path):
    name = os.path.splitext(os.path.basename(path))[0]
    safe = re.sub(r'[^a-zA-Zа-яА-Я0-9_]', '_', name)
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
        for a in atoms: f.write(json.dumps(a, ensure_ascii=False) + '\n')

def already_done(atoms, path):
    aid = video_atom_id(path)
    return any(a.get('id') == aid and len(a.get('content','')) > 100 for a in atoms)

def split_video_if_needed(path, tmpdir):
    """Если файл > MAX_MB — режет ffmpeg на куски, возвращает список путей."""
    size_mb = os.path.getsize(path) / 1024**2
    if size_mb <= MAX_MB:
        return [path]
    
    print(f"  Файл {size_mb:.0f} MB > {MAX_MB} MB, режу ffmpeg...")
    base = os.path.splitext(os.path.basename(path))[0]
    pattern = os.path.join(tmpdir, f"{base}_%03d.mp4")
    # Режем по времени ~600 секунд (~10 мин) или по размеру
    cmd = ["ffmpeg", "-i", path, "-c", "copy", "-f", "segment",
           "-segment_time", "600", "-reset_timestamps", "1", pattern, "-y", "-loglevel", "error"]
    subprocess.run(cmd, check=True)
    parts = sorted([os.path.join(tmpdir, f) for f in os.listdir(tmpdir) if f.startswith(base)])
    print(f"  Нарезано: {len(parts)} частей")
    return parts

def transcribe_groq(path):
    """Транскрибирует файл через Groq Whisper API, возвращает текст."""
    import urllib.request, urllib.error
    
    with open(path, 'rb') as f:
        audio_data = f.read()
    
    boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
    filename = os.path.basename(path)
    
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: audio/mp4\r\n\r\n"
    ).encode() + audio_data + (
        f"\r\n--{boundary}\r\n"
        f'Content-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3-turbo\r\n'
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="language"\r\n\r\nru\r\n'
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="response_format"\r\n\r\ntext\r\n'
        f"--{boundary}--\r\n"
    ).encode()
    
    req = urllib.request.Request(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        data=body,
        headers={
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        }
    )
    resp = urllib.request.urlopen(req, timeout=120)
    return resp.read().decode('utf-8').strip()

def main():
    log = open(LOG_FILE, 'a', encoding='utf-8')
    def lp(msg): print(msg, flush=True); log.write(msg+'\n'); log.flush()

    lp(f"\n=== Groq транскрипция: {time.strftime('%Y-%m-%d %H:%M:%S')} ===")
    
    if GROQ_API_KEY == "ВСТАВЬ_КЛЮЧ_СЮДА":
        lp("❌ СТОП: вставь GROQ_API_KEY в скрипт"); return

    videos = find_videos()
    atoms  = load_atoms()
    todo   = [v for v in videos if not already_done(atoms, v)]
    
    lp(f"Всего видео: {len(videos)}, уже готово: {len(videos)-len(todo)}, осталось: {len(todo)}")
    if not todo: lp("Все готово!"); return

    processed = errors = 0
    with tempfile.TemporaryDirectory() as tmpdir:
        for i, path in enumerate(todo):
            basename = os.path.basename(path)
            lp(f"\n[{i+1}/{len(todo)}] {basename} ({os.path.getsize(path)/1024**2:.0f} MB)")
            t0 = time.time()
            try:
                parts = split_video_if_needed(path, tmpdir)
                texts = []
                for j, part in enumerate(parts):
                    lp(f"  Часть {j+1}/{len(parts)}: {os.path.basename(part)}")
                    text = transcribe_groq(part)
                    texts.append(text)
                    if len(parts) > 1: time.sleep(1)
                
                full_text = " ".join(texts)
                elapsed = time.time() - t0
                lp(f"  Готово за {elapsed:.0f}с, символов: {len(full_text)}")

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
                idx = next((j for j,a in enumerate(atoms) if a.get('id')==aid), None)
                if idx is not None: atoms[idx] = atom
                else: atoms.append(atom)
                save_atoms(atoms)
                processed += 1
                lp(f"  Атом сохранён: {aid}")

            except Exception as e:
                lp(f"  ОШИБКА: {e}"); errors += 1

    lp(f"\n=== ИТОГ: обработано {processed}, ошибок {errors} ===")
    log.close()

if __name__ == "__main__":
    main()
```

### B.1 Вставить ключ и запустить тест (1 видео)

```powershell
# Вставь ключ в скрипт: GROQ_API_KEY = "gsk_..."
# Тест на одном маленьком видео
python -c "
import sys; sys.stdout.reconfigure(encoding='utf-8')
# Временно — проверить API
import urllib.request, json
key = 'gsk_...'  # твой ключ
req = urllib.request.Request('https://api.groq.com/openai/v1/models',
    headers={'Authorization': f'Bearer {key}'})
data = json.loads(urllib.request.urlopen(req).read())
whisper = [m['id'] for m in data['data'] if 'whisper' in m['id'].lower()]
print('Whisper модели на Groq:', whisper)
"
```

### B.2 Запустить полный прогон

```powershell
cd C:\dia
python output\transcribe_groq.py
```

---

## Часть C. После транскрипции

```powershell
# 1. Обогатить DTC-кодами
python output\enrich_dtc.py

# 2. Перезагрузить Qdrant
docker start qdrant
Start-Sleep 3
python output\qdrant_pilot.py
```

---

## Ожидаемое ускорение

| Метод | Видео 1ч | Факт ЕР6 |
|-------|----------|----------|
| faster-whisper large-v3 CPU | ~3-4 ч | 10 ч |
| **Groq whisper-large-v3-turbo** | **~30-60 сек** | — |

Groq быстрее в **100-400x**. Бесплатный лимит: ~8 часов аудио в сутки.
