#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Батч-скрипт зрения: прогоняет изображения атомов через мультимодальную модель,
дописывает shape_description и visual_facts.

Настрой API в разделе НАСТРОЙКИ ниже (один из вариантов: Claude, GigaChat, OpenAI, локальный).

Запуск:
  python3 vision_pass.py                 # обработать все атомы с картинками без описания
  python3 vision_pass.py --dry-run       # показать что будет обработано, без вызовов API
  python3 vision_pass.py --limit 5       # обработать максимум 5 картинок (для теста)
"""

import json, sys, os, base64, time, glob
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

# ================= НАСТРОЙКИ =================

ATOMS_FILE = "output/atoms_clean.jsonl"
ATOMS_OUT  = "output/atoms_clean.jsonl"  # перезаписываем (или поменяй на другой путь)

# ---------- ВЫБЕРИ ОДИН API (раскомментируй нужный) ----------

# Вариант E: OpenRouter (активный) — gemini-2.0-flash-001, недорогой vision
API_TYPE  = "openrouter"
API_KEY   = os.environ.get("OPENROUTER_API_KEY", "")
API_URL   = "https://openrouter.ai/api/v1/chat/completions"
API_MODEL = "google/gemini-2.5-flash-lite"  # $0.0001/1M input — самая дешёвая с vision на OpenRouter

# Вариант D: DeepSeek Vision (text only — не работает для картинок)
# API_TYPE  = "deepseek"
# API_KEY   = os.environ.get("DEEPSEEK_API_KEY", "")
# API_URL   = "https://api.deepseek.com/chat/completions"
# API_MODEL = "deepseek-v4-flash"

# Вариант A: Google Gemini (квота исчерпана)
# API_TYPE = "gemini"
# API_KEY  = os.environ.get("GEMINI_API_KEY", "")
# API_MODEL = "gemini-2.0-flash"

# Задержка между запросами (секунды) — чтобы не упереться в rate limit
DELAY = 1.0

# ================= ПРОМПТЫ ПО ТИПУ КАРТИНКИ =================

PROMPT_WAVEFORM = """Ты — эксперт по автомобильной диагностике. На изображении — осциллограмма с мотор-тестера.
Опиши форму сигнала по пунктам:
1. Базовая линия (ровная/шумная, уровень).
2. Есть ли игла пробоя (резкий пик)? Насколько выражена?
3. Линия горения: есть ли, стабильная ли, какой длительности?
4. Затухающие колебания после горения?
5. Общий вердикт: это норма или дефект? Какой именно дефект, если есть?
6. К какой системе относится (зажигание/датчик/форсунка/давление)?
Отвечай по-русски, кратко и по существу. Не выдумывай цифры, которых не видно."""

PROMPT_SCHEMATIC = """Ты — эксперт по автомобильной электрике. На изображении — электрическая схема или распиновка.
Опиши что видишь:
1. Какие компоненты на схеме (датчики, реле, ЭБУ, разъёмы)?
2. Какие цепи показаны (питание, масса, сигнал)?
3. Если это распиновка разъёма — перечисли пины: номер → назначение → цвет провода.
4. К какой системе относится (зажигание/питание/CAN и т.д.)?
Отвечай по-русски, структурированно."""

PROMPT_PHOTO = """Ты — эксперт по автомобильной диагностике. На изображении — фотография детали/узла/прибора.
Опиши:
1. Что именно изображено?
2. Видны ли дефекты, повреждения, загрязнения?
3. Если на фото прибор (мультиметр, сканер) — какое показание на экране?
4. Какой вывод можно сделать?
Отвечай по-русски, кратко."""

def get_prompt(atom):
    """Подбирает промпт под тип картинки."""
    rd = atom.get("reference_data") or {}
    kind = rd.get("kind", "")
    if kind == "waveform" or "осцилл" in atom.get("title", "").lower():
        return PROMPT_WAVEFORM
    elif kind in ("pinout", "wiring") or "схем" in atom.get("title", "").lower():
        return PROMPT_SCHEMATIC
    else:
        return PROMPT_PHOTO


# ================= API-ВЫЗОВЫ =================

def load_image_b64(path):
    """Загружает картинку и возвращает base64."""
    with open(path, "rb") as f:
        return base64.standard_b64encode(f.read()).decode()

def call_gemini(image_b64, prompt, media_type="image/png"):
    import urllib.request
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{API_MODEL}:generateContent?key={API_KEY}"
    body = json.dumps({
        "contents": [{"parts": [
            {"inline_data": {"mime_type": media_type, "data": image_b64}},
            {"text": prompt}
        ]}],
        "generationConfig": {"maxOutputTokens": 800}
    }).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    resp = urllib.request.urlopen(req)
    data = json.loads(resp.read())
    return data["candidates"][0]["content"]["parts"][0]["text"]

def call_claude(image_b64, prompt, media_type="image/png"):
    import urllib.request
    body = json.dumps({
        "model": API_MODEL, "max_tokens": 800,
        "messages": [{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_b64}},
            {"type": "text", "text": prompt}
        ]}]
    }).encode()
    req = urllib.request.Request(API_URL, data=body, headers={
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01"
    })
    resp = urllib.request.urlopen(req)
    data = json.loads(resp.read())
    return data["content"][0]["text"]

def call_openai(image_b64, prompt, media_type="image/png"):
    import urllib.request
    body = json.dumps({
        "model": API_MODEL, "max_tokens": 800,
        "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{image_b64}"}},
            {"type": "text", "text": prompt}
        ]}]
    }).encode()
    req = urllib.request.Request(API_URL, data=body, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}"
    })
    resp = urllib.request.urlopen(req)
    data = json.loads(resp.read())
    return data["choices"][0]["message"]["content"]

def call_deepseek(image_b64, prompt, media_type="image/png"):
    import urllib.request
    body = json.dumps({
        "model": API_MODEL,
        "max_tokens": 800,
        "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{image_b64}"}},
            {"type": "text", "text": prompt}
        ]}]
    }).encode()
    req = urllib.request.Request(API_URL, data=body, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}"
    })
    resp = urllib.request.urlopen(req)
    data = json.loads(resp.read())
    return data["choices"][0]["message"]["content"]

def call_openrouter(image_b64, prompt, media_type="image/png"):
    import urllib.request
    body = json.dumps({
        "model": API_MODEL, "max_tokens": 800,
        "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{image_b64}"}},
            {"type": "text", "text": prompt}
        ]}]
    }).encode()
    req = urllib.request.Request(API_URL, data=body, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}",
        "HTTP-Referer": "http://localhost",
        "X-Title": "AutoDiag-RAG"
    })
    resp = urllib.request.urlopen(req, timeout=60)
    data = json.loads(resp.read())
    return data["choices"][0]["message"]["content"]

def call_gigachat(image_b64, prompt, media_type="image/png"):
    import urllib.request
    body = json.dumps({
        "model": API_MODEL, "max_tokens": 800,
        "messages": [{"role": "user", "content": prompt + "\n[Изображение приложено]"}],
    }).encode()
    req = urllib.request.Request(API_URL, data=body, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}"
    })
    resp = urllib.request.urlopen(req)
    data = json.loads(resp.read())
    return data["choices"][0]["message"]["content"]

def describe_image(image_path, prompt):
    """Вызывает выбранный API."""
    ext = os.path.splitext(image_path)[1].lower()
    media = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg"}.get(ext.strip("."), "image/png")
    b64 = load_image_b64(image_path)

    if API_TYPE == "openrouter":
        return call_openrouter(b64, prompt, media)
    elif API_TYPE == "deepseek":
        return call_deepseek(b64, prompt, media)
    elif API_TYPE == "gemini":
        return call_gemini(b64, prompt, media)
    elif API_TYPE == "claude":
        return call_claude(b64, prompt, media)
    elif API_TYPE == "openai":
        return call_openai(b64, prompt, media)
    else:
        raise ValueError(f"Неизвестный API_TYPE: {API_TYPE}")


# ================= ОСНОВНОЙ ЦИКЛ =================

def find_image_path(atom):
    """Находит реальный путь к картинке атома."""
    img = atom.get("image") or ""
    if not img:
        return None
    # Нормализуем путь (Windows → Unix)
    img = img.replace("\\", "/")
    if os.path.exists(img):
        return img
    # Попробуем относительно текущей папки
    for prefix in ["", "output/", "./output/"]:
        candidate = os.path.join(prefix, os.path.basename(img))
        if os.path.exists(candidate):
            return candidate
    return None


def needs_vision(atom):
    """Определяет, нужно ли прогнать зрение для этого атома."""
    rd = atom.get("reference_data") or {}
    # Waveform без shape_description
    if rd.get("kind") == "waveform" and not rd.get("shape_description"):
        return True
    # Любой атом с image но без visual_facts и shape_description
    if atom.get("image") and not atom.get("visual_facts") and not rd.get("shape_description"):
        return True
    return False


def main():
    dry_run = "--dry-run" in sys.argv
    limit = None
    if "--limit" in sys.argv:
        idx = sys.argv.index("--limit")
        limit = int(sys.argv[idx + 1])

    atoms = [json.loads(l) for l in open(ATOMS_FILE, encoding='utf-8')]
    todo = [(i, a) for i, a in enumerate(atoms) if needs_vision(a)]
    print(f"Атомов в базе: {len(atoms)}")
    print(f"Нужно зрение: {len(todo)}")

    if limit:
        todo = todo[:limit]
        print(f"Лимит: {limit}")

    if dry_run:
        for i, a in todo:
            img = find_image_path(a)
            status = "✅ файл есть" if img else "❌ картинка не найдена"
            print(f"  [{i}] {a.get('id','')} | {a.get('image','')} | {status}")
        print(f"\nDry run: {len(todo)} картинок к обработке. Запусти без --dry-run.")
        return

    if not API_KEY:
        print("❌ API_KEY не задан. Установи переменную окружения или впиши в скрипт.")
        return

    processed = 0
    errors = 0
    for idx, (i, atom) in enumerate(todo):
        img_path = find_image_path(atom)
        if not img_path:
            print(f"⚠️ [{atom.get('id')}] картинка не найдена: {atom.get('image')}")
            errors += 1
            continue

        prompt = get_prompt(atom)
        print(f"[{idx+1}/{len(todo)}] {atom.get('id')} ...", end=" ", flush=True)

        try:
            description = describe_image(img_path, prompt)
            # Записываем результат
            rd = atom.setdefault("reference_data", {})
            if rd.get("kind") == "waveform":
                rd["shape_description"] = description
            else:
                atom.setdefault("visual_facts", []).append({
                    "locator": os.path.basename(img_path),
                    "description": description,
                    "reading": None
                })
            atom["needs_human_review"] = False
            atom["review_notes"] = ""
            atoms[i] = atom
            processed += 1
            print("✅")
        except Exception as e:
            print(f"❌ {e}")
            errors += 1

        time.sleep(DELAY)

    # Сохраняем обновлённые атомы
    with open(ATOMS_OUT, "w", encoding="utf-8") as f:
        for a in atoms:
            f.write(json.dumps(a, ensure_ascii=False) + "\n")

    print(f"\n{'='*40}")
    print(f"Обработано: {processed}")
    print(f"Ошибок: {errors}")
    print(f"Пропущено (нет файла): {errors}")
    print(f"Сохранено в: {ATOMS_OUT}")


if __name__ == "__main__":
    main()
