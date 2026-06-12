#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Конвертация PDF-мануалов с dongcheyun.com в атомы RAG.

Извлекает текст из PDF, отправляет в LLM, получает структурированные атомы
(DTC-коды, процедуры диагностики, эталонные значения) и добавляет в базу.

Требования:
  pip install pdfplumber python-dotenv requests

Запуск:
  python dongcheyun_to_atoms.py --pdf "C:/Downloads/Haval_H6_DTC.pdf" --make Haval --model "H6" --engine "GW4B15B 1.5T" --year 2021
  python dongcheyun_to_atoms.py --pdf "C:/Downloads/Chery_Tiggo4_diag.pdf" --make Chery --model "Tiggo 4"
  python dongcheyun_to_atoms.py --dir "C:/Downloads/dongcheyun/" --make Changan --model "CS35 Plus"

Флаги:
  --pdf PATH      один PDF-файл
  --dir PATH      папка с PDF (обработает все)
  --make МАРКА    марка авто (обязательно)
  --model МОДЕЛЬ  модель авто (обязательно)
  --engine ДВС    двигатель (опционально)
  --year ГОД      год (опционально)
  --dry-run       вывести атомы в консоль, не сохранять
  --limit N       не более N страниц с PDF (тест)
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8')
load_dotenv(r"C:\dia\.env")

OR_KEY   = os.getenv("OPENROUTER_API_KEY")
OR_URL   = "https://openrouter.ai/api/v1/chat/completions"
OR_MODEL = "google/gemini-2.5-flash-lite"   # дешевле, справляется с таблицами
OUTPUT_JSONL = r"C:\dia\output\atoms_chinese_v2.jsonl"
ATOMS_MAIN   = r"C:\dia\output\atoms_clean.jsonl"
CHUNK_PAGES  = 8    # страниц за один LLM-запрос
DELAY        = 1.5  # пауза между запросами


# ────────────────────────────────────────────────────────────────────
# Извлечение текста из PDF
# ────────────────────────────────────────────────────────────────────

def extract_pdf_text(pdf_path: str, limit_pages: int = None) -> list[dict]:
    """Возвращает список {'page': N, 'text': '...'}"""
    try:
        import pdfplumber
    except ImportError:
        print("❌ Установи pdfplumber: pip install pdfplumber")
        sys.exit(1)

    pages = []
    with pdfplumber.open(pdf_path) as pdf:
        total = len(pdf.pages)
        cap = min(total, limit_pages) if limit_pages else total
        print(f"  PDF: {Path(pdf_path).name} — {total} стр. (читаем {cap})")
        for i in range(cap):
            text = pdf.pages[i].extract_text() or ""
            # Таблицы — отдельно, добавляем как строки
            for table in pdf.pages[i].extract_tables() or []:
                for row in table:
                    cleaned = [str(c or "").strip() for c in row]
                    if any(cleaned):
                        text += "\n" + " | ".join(cleaned)
            if text.strip():
                pages.append({"page": i + 1, "text": text.strip()})
    return pages


def chunk_pages(pages: list[dict], size: int) -> list[list[dict]]:
    return [pages[i:i+size] for i in range(0, len(pages), size)]


# ────────────────────────────────────────────────────────────────────
# LLM-запрос
# ────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """Ты — эксперт по диагностике китайских автомобилей.
Тебе передаётся текст из сервисного мануала или диагностического руководства на китайском или русском языке.
Твоя задача — извлечь все диагностические знания и вернуть их как JSON-массив атомов.

Правила:
- Если видишь таблицу DTC-кодов — каждый код = один атом типа "dtc"
- Если видишь процедуру диагностики или ремонта — это атом типа "procedure"
- Если видишь типичный кейс или характерную неисправность — атом типа "case"
- Если видишь эталонные значения (допуски, нормы) — атом типа "reference"
- НЕ придумывай данные — только то что есть в тексте
- Переводи на русский язык
- Верни ТОЛЬКО валидный JSON-массив, без markdown, без пояснений

Структура каждого атома:
{
  "atom_type": "dtc|procedure|case|reference",
  "title": "краткое название (до 80 символов)",
  "dtc_codes": ["P0xxx"],
  "system": "двигатель|трансмиссия|тормоза|электрика|кузов|климат|прочее",
  "symptom": "описание симптома или null",
  "content": "полное описание знания на русском (2-5 предложений)",
  "diagnostic_steps": [
    {"action": "шаг", "measurement": "что измерять", "expected": "норма"}
  ],
  "root_cause": "причина неисправности или null",
  "solution": "решение или null",
  "parts": [{"name": "название детали", "part_number": "артикул или null"}],
  "reference_data": {"kind": "voltage|pressure|resistance|timing|other", "value": "значение с единицами"}
}

Если не знаешь значение поля — ставь null или [].
Верни [] если в тексте нет диагностических данных."""


def ask_llm(chunk_text: str, vehicle_context: str) -> list[dict]:
    """Отправляет чанк в LLM, возвращает список атомов."""
    user_msg = f"""Автомобиль: {vehicle_context}

Текст из мануала:
{chunk_text[:12000]}

Извлеки диагностические атомы."""

    body = {
        "model": OR_MODEL,
        "max_tokens": 6000,
        "temperature": 0.1,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": user_msg}
        ]
    }

    try:
        resp = requests.post(
            OR_URL, json=body,
            headers={
                "Authorization": f"Bearer {OR_KEY}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost",
                "X-Title": "AutoDiag-2LS"
            },
            timeout=90
        )
        data = resp.json()
        raw = data["choices"][0]["message"]["content"].strip()

        # Убрать возможный markdown-блок
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)

        atoms = json.loads(raw)
        if isinstance(atoms, list):
            return atoms
        return []
    except Exception as e:
        print(f"  ⚠️ LLM ошибка: {e}")
        return []


# ────────────────────────────────────────────────────────────────────
# Формирование финального атома
# ────────────────────────────────────────────────────────────────────

def make_atom(raw: dict, vehicle: dict, source_file: str, page_range: str) -> dict:
    """Дополняет сырой атом из LLM до формата базы."""
    dtc_codes = raw.get("dtc_codes") or []
    atom_type  = raw.get("atom_type", "procedure")
    title      = raw.get("title", "")[:100]

    # Генерация уникального ID
    make  = vehicle.get("make", "cn").lower().replace(" ", "_")
    model = vehicle.get("model", "").lower().replace(" ", "_")
    slug  = re.sub(r"[^a-z0-9_]", "", title.lower().replace(" ", "_"))[:30]
    dtc_slug = ("_" + dtc_codes[0].lower()) if dtc_codes else ""
    atom_id = f"cn_{make}_{model}{dtc_slug}_{slug}"[:80]

    return {
        "id": atom_id,
        "stage": "final",
        "atom_type": atom_type,
        "vehicle": {
            "make":       vehicle.get("make"),
            "model":      vehicle.get("model"),
            "year":       vehicle.get("year"),
            "generation": None,
            "engine":     vehicle.get("engine"),
            "body":       None
        },
        "title":      title,
        "symptom":    raw.get("symptom"),
        "dtc_codes":  dtc_codes,
        "system":     raw.get("system", "прочее"),
        "content":    raw.get("content", ""),
        "diagnostic_steps": raw.get("diagnostic_steps") or [],
        "root_cause": raw.get("root_cause"),
        "solution":   raw.get("solution"),
        "parts":      raw.get("parts") or [],
        "visual_facts": [],
        "reference_data": raw.get("reference_data") or {"kind": None, "verdict": "неизвестно"},
        "image":      None,
        "source": {
            "file": Path(source_file).name,
            "type": "pdf_manual",
            "locator": f"p.{page_range}"
        },
        "confidence":         "medium",
        "needs_human_review": True,
        "review_notes":       "Извлечено автоматически из PDF dongcheyun.com — требует проверки",
        "dtc": dtc_codes
    }


# ────────────────────────────────────────────────────────────────────
# Обработка одного PDF
# ────────────────────────────────────────────────────────────────────

def process_pdf(pdf_path: str, vehicle: dict, dry_run: bool, limit_pages: int) -> list[dict]:
    print(f"\n📄 Обрабатываю: {Path(pdf_path).name}")
    pages = extract_pdf_text(pdf_path, limit_pages)
    if not pages:
        print("  ⚠️ Текст не извлечён — пропускаю")
        return []

    vehicle_ctx = (
        f"{vehicle.get('make', '')} {vehicle.get('model', '')} "
        f"{vehicle.get('engine', '')} {vehicle.get('year', '')}"
    ).strip()

    chunks = chunk_pages(pages, CHUNK_PAGES)
    all_atoms = []

    for ci, chunk in enumerate(chunks, 1):
        p_start = chunk[0]["page"]
        p_end   = chunk[-1]["page"]
        text    = "\n\n".join(p["text"] for p in chunk)
        print(f"  Чанк {ci}/{len(chunks)} (стр. {p_start}–{p_end}): {len(text)} символов")

        raw_atoms = ask_llm(text, vehicle_ctx)
        print(f"    LLM вернул: {len(raw_atoms)} атомов")

        for raw in raw_atoms:
            atom = make_atom(raw, vehicle, pdf_path, f"{p_start}-{p_end}")
            if atom["content"]:  # пропускаем пустышки
                all_atoms.append(atom)

        time.sleep(DELAY)

    print(f"  ✅ Итого атомов из файла: {len(all_atoms)}")

    if dry_run:
        for a in all_atoms[:3]:
            print(json.dumps(a, ensure_ascii=False, indent=2))
    return all_atoms


# ────────────────────────────────────────────────────────────────────
# Сохранение
# ────────────────────────────────────────────────────────────────────

def save_atoms(atoms: list[dict], dry_run: bool):
    if dry_run:
        print(f"\n[dry-run] Было бы сохранено: {len(atoms)} атомов")
        return

    # Загрузить существующие ID из обоих файлов
    existing_ids = set()
    for fpath in [ATOMS_MAIN, OUTPUT_JSONL]:
        if os.path.exists(fpath):
            with open(fpath, encoding="utf-8") as f:
                for line in f:
                    try:
                        existing_ids.add(json.loads(line)["id"])
                    except Exception:
                        pass

    new_atoms = [a for a in atoms if a["id"] not in existing_ids]

    # Дедупликация внутри нового набора по id
    seen = set()
    deduped = []
    for a in new_atoms:
        if a["id"] not in seen:
            seen.add(a["id"])
            deduped.append(a)

    if not deduped:
        print("Все атомы уже есть в базе — ничего нового.")
        return

    # Записать в atoms_chinese_v2.jsonl
    with open(OUTPUT_JSONL, "a", encoding="utf-8") as f:
        for a in deduped:
            f.write(json.dumps(a, ensure_ascii=False) + "\n")

    # Дописать в основную базу
    with open(ATOMS_MAIN, "a", encoding="utf-8") as f:
        for a in deduped:
            f.write(json.dumps(a, ensure_ascii=False) + "\n")

    print(f"\n✅ Сохранено: {len(deduped)} новых атомов")
    print(f"   → {OUTPUT_JSONL}")
    print(f"   → {ATOMS_MAIN}")
    print(f"\nСледующий шаг: запусти import_mongo.py для загрузки в MongoDB")


# ────────────────────────────────────────────────────────────────────
# CLI
# ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="PDF мануал → атомы RAG")
    parser.add_argument("--pdf",    help="Путь к PDF-файлу")
    parser.add_argument("--dir",    help="Папка с PDF-файлами")
    parser.add_argument("--make",   required=True, help="Марка (Haval, Chery, ...)")
    parser.add_argument("--model",  required=True, help="Модель (H6, Tiggo 4, ...)")
    parser.add_argument("--engine", default=None,  help="Двигатель (1.5T, 2.0d, ...)")
    parser.add_argument("--year",   default=None,  help="Год выпуска")
    parser.add_argument("--dry-run", action="store_true", help="Не сохранять, вывести примеры")
    parser.add_argument("--limit",  type=int, default=None, help="Лимит страниц PDF (тест)")
    args = parser.parse_args()

    if not OR_KEY:
        print("❌ OPENROUTER_API_KEY не найден в .env")
        sys.exit(1)

    vehicle = {
        "make":   args.make,
        "model":  args.model,
        "engine": args.engine,
        "year":   args.year
    }

    pdf_files = []
    if args.pdf:
        pdf_files = [args.pdf]
    elif args.dir:
        pdf_files = [str(p) for p in Path(args.dir).glob("*.pdf")]
        print(f"Найдено PDF в папке: {len(pdf_files)}")
    else:
        parser.error("Укажи --pdf или --dir")

    all_atoms = []
    for pdf in pdf_files:
        atoms = process_pdf(pdf, vehicle, args.dry_run, args.limit)
        all_atoms.extend(atoms)

    print(f"\n📊 Всего извлечено атомов: {len(all_atoms)}")
    save_atoms(all_atoms, args.dry_run)


if __name__ == "__main__":
    main()
