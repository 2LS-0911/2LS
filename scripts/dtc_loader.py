#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Загрузка DTC-кодов OBD-II в атомы RAG.

1. Скачивает коды из GitHub (fabiovila/OBDIICodes)
2. Переводит описания на русский через Gemini API (батчами по 50)
3. Определяет систему по префиксу кода
4. Создаёт reference-атомы и добавляет в atoms_clean.jsonl

Требования:
  export GEMINI_API_KEY="AIza..."

Запуск:
  python3 dtc_loader.py              # полный прогон
  python3 dtc_loader.py --no-translate  # без перевода (английские описания)
  python3 dtc_loader.py --limit 100  # только первые 100 (тест)
"""

import json, os, sys, time, urllib.request
sys.stdout.reconfigure(encoding='utf-8')

ATOMS_FILE = "output/atoms_clean.jsonl"
DTC_URL = "https://raw.githubusercontent.com/fabiovila/OBDIICodes/master/codes.json"
OR_KEY   = os.environ.get("OPENROUTER_API_KEY", "")
OR_URL   = "https://openrouter.ai/api/v1/chat/completions"
OR_MODEL = "google/gemini-2.5-flash"
BATCH_SIZE = 50
DELAY = 0.5

# Система по префиксу кода
def code_to_system(code):
    c = code.upper()
    if c.startswith("P00") or c.startswith("P01"): return "питание"
    if c.startswith("P02"): return "питание"
    if c.startswith("P03"): return "зажигание"
    if c.startswith("P04"): return "выпуск/катализатор"
    if c.startswith("P05") or c.startswith("P06"): return "прочее"
    if c.startswith("P07"): return "прочее"  # трансмиссия
    if c.startswith("P0A"): return "прочее"  # гибрид
    if c.startswith("P"): return "прочее"
    if c.startswith("B"): return "кузовная электроника"
    if c.startswith("C"): return "прочее"  # шасси
    if c.startswith("U"): return "CAN-шина"
    return "прочее"


def translate_batch(descriptions):
    """Переводит список описаний на русский через OpenRouter."""
    import urllib.request as ur
    prompt = (
        "Переведи каждую строку на русский язык. "
        "Это коды ошибок OBD-II автомобиля. "
        "Верни ТОЛЬКО переведённые строки, по одной на строку, в том же порядке. "
        "Без нумерации, без пояснений.\n\n"
        + "\n".join(descriptions)
    )
    body = json.dumps({
        "model": OR_MODEL,
        "max_tokens": 4000,
        "temperature": 0.1,
        "messages": [{"role": "user", "content": prompt}]
    }).encode('utf-8')
    req = ur.Request(OR_URL, data=body, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {OR_KEY}",
        "HTTP-Referer": "http://localhost",
        "X-Title": "AutoDiag-DTC"
    })
    try:
        resp = ur.urlopen(req, timeout=60)
        data = json.loads(resp.read())
        text = data["choices"][0]["message"]["content"].strip()
        lines = [l.strip() for l in text.strip().split("\n") if l.strip()]
        if len(lines) == len(descriptions):
            return lines
        else:
            print(f"  ⚠️ Вернул {len(lines)} строк вместо {len(descriptions)}, оставляю английский")
            return descriptions
    except Exception as e:
        print(f"  ❌ Ошибка перевода: {e}")
        return descriptions


def main():
    no_translate = "--no-translate" in sys.argv
    limit = None
    if "--limit" in sys.argv:
        idx = sys.argv.index("--limit")
        limit = int(sys.argv[idx + 1])

    # 1. Скачать
    print("Скачиваю DTC-коды...")
    resp = urllib.request.urlopen(DTC_URL)
    codes = json.loads(resp.read())
    print(f"Скачано: {len(codes)} кодов")

    if limit:
        codes = codes[:limit]
        print(f"Лимит: {limit}")

    # Убрать дубли и пустые
    seen = set()
    clean = []
    for c in codes:
        code = c.get("Code", "").strip().split("/")[0]  # убрать "/SAE"
        if code and code not in seen:
            seen.add(code)
            clean.append({"code": code, "desc_en": c.get("Description", "").strip()})
    print(f"Уникальных: {len(clean)}")

    # 2. Перевести
    if no_translate:
        print("Перевод пропущен (--no-translate)")
        for c in clean:
            c["desc_ru"] = c["desc_en"]
    else:
        print(f"Перевожу через Gemini батчами по {BATCH_SIZE}...")
        for i in range(0, len(clean), BATCH_SIZE):
            batch = clean[i:i+BATCH_SIZE]
            descs = [c["desc_en"] for c in batch]
            translated = translate_batch(descs)
            for c, t in zip(batch, translated):
                c["desc_ru"] = t
            done = min(i + BATCH_SIZE, len(clean))
            print(f"  {done}/{len(clean)}")
            time.sleep(DELAY)

    # 3. Конвертировать в атомы
    atoms = []
    for c in clean:
        atom = {
            "id": f"dtc_{c['code']}",
            "stage": "final",
            "atom_type": "reference",
            "vehicle": {"make": None, "model": None, "year": None, "engine": None},
            "title": f"{c['code']} — {c['desc_ru'][:80]}",
            "symptom": None,
            "dtc_codes": [c["code"]],
            "system": code_to_system(c["code"]),
            "content": c["desc_ru"],
            "diagnostic_steps": [],
            "root_cause": None,
            "solution": None,
            "parts": [],
            "visual_facts": [],
            "reference_data": {"kind": "dtc", "code": c["code"],
                               "description_ru": c["desc_ru"],
                               "description_en": c["desc_en"]},
            "image": None,
            "source": {"file": "github.com/fabiovila/OBDIICodes", "type": "database", "locator": c["code"]},
            "confidence": "high",
            "needs_human_review": False,
            "review_notes": ""
        }
        atoms.append(atom)

    # 4. Добавить в atoms_clean.jsonl (дедупликация по id)
    existing = {}
    if os.path.exists(ATOMS_FILE):
        existing = {json.loads(l)["id"]: json.loads(l) for l in open(ATOMS_FILE, encoding='utf-8')}
        print(f"Существующих атомов: {len(existing)}")

    added = 0
    for a in atoms:
        if a["id"] not in existing:
            existing[a["id"]] = a
            added += 1

    with open(ATOMS_FILE, "w", encoding="utf-8") as f:
        for a in existing.values():
            f.write(json.dumps(a, ensure_ascii=False) + "\n")

    print(f"\n✅ Добавлено DTC-атомов: {added}")
    print(f"Всего атомов в базе: {len(existing)}")
    print(f"Сохранено: {ATOMS_FILE}")


if __name__ == "__main__":
    main()
