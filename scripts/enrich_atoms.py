"""
Обогащение пустых reference атомов через LLM (OpenRouter / Gemini Flash).
Добавляет content, root_cause, diagnostic_steps к атомам без содержимого.
Обновляет atoms_clean.jsonl И MongoDB.

Стоимость: ~2300 атомов × ~300 токенов ≈ $0.15–0.30
"""
import json
import os
import sys
import time
import requests
from pymongo import MongoClient
from dotenv import load_dotenv

sys.stdout = sys.stderr
load_dotenv(r"C:\dia\.env")

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
MONGODB_URI = os.getenv("MONGODB_URI")
JSONL_PATH = r"C:\dia\output\atoms_clean.jsonl"
BACKUP_PATH = r"C:\dia\output\atoms_clean.jsonl.bak"
OR_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "google/gemini-2.5-flash-lite"
BATCH_SIZE = 10  # атомов за один LLM-запрос
DELAY = 2        # секунды между запросами (OpenRouter не такой строгий)

# ── Промпты по типу атома ─────────────────────────────────────────

DTC_SYSTEM = """Ты — эксперт по диагностике автомобилей OBD-II.
Для каждого DTC кода из списка сгенерируй описание на русском языке.
Отвечай ТОЛЬКО валидным JSON-массивом без markdown."""

DTC_USER = """Для каждого DTC кода верни объект:
{
  "id": "...",
  "content": "Полное описание кода: что означает, какая система, при каких условиях появляется",
  "root_cause": "Основные причины (перечисли через точку с запятой, 5-7 причин)",
  "symptoms": ["симптом 1", "симптом 2", "симптом 3"],
  "diagnostic_steps": ["шаг 1", "шаг 2", "шаг 3", "шаг 4"]
}

Коды:
"""

OSC_SYSTEM = """Ты — эксперт по диагностике автомобилей и осциллографии.
Для каждого паттерна осциллограммы сгенерируй описание на русском языке.
Отвечай ТОЛЬКО валидным JSON-массивом без markdown."""

OSC_USER = """Для каждого паттерна осциллограммы верни объект:
{
  "id": "...",
  "content": "Описание осциллограммы: что измеряется, как выглядит сигнал, что показывает",
  "root_cause": "Что означает данный паттерн (норма или неисправность и её причина)",
  "symptoms": ["симптом 1", "симптом 2"],
  "diagnostic_steps": ["на что обратить внимание при анализе", "как интерпретировать"]
}

Паттерны:
"""


def classify_atom(atom: dict) -> str:
    atom_id = atom.get("id", "")
    dtc_codes = atom.get("dtc_codes") or []
    if dtc_codes or atom_id.startswith("dtc_"):
        return "dtc"
    return "oscillogram"


def build_atom_description(atom: dict, atom_type: str) -> str:
    atom_id = atom.get("id", "")
    title = atom.get("title", "")
    system = atom.get("system", "")
    vehicle = atom.get("vehicle", {})
    dtc_codes = atom.get("dtc_codes") or []

    if atom_type == "dtc":
        dtc = dtc_codes[0] if dtc_codes else atom_id.replace("dtc_", "").upper()
        return f'id="{atom_id}" dtc="{dtc}" title="{title}" system="{system}"'
    else:
        v_str = ""
        if isinstance(vehicle, dict):
            make = vehicle.get("make") or ""
            model = vehicle.get("model") or ""
            engine = vehicle.get("engine") or ""
            v_str = f"{make} {model} {engine}".strip()
        return f'id="{atom_id}" title="{title}" vehicle="{v_str}" system="{system}"'


def call_llm(descriptions: list[str], atom_type: str) -> list[dict] | None:
    if atom_type == "dtc":
        system_msg = DTC_SYSTEM
        user_msg = DTC_USER + "\n".join(f"- {d}" for d in descriptions)
    else:
        system_msg = OSC_SYSTEM
        user_msg = OSC_USER + "\n".join(f"- {d}" for d in descriptions)

    try:
        resp = requests.post(
            OR_URL,
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": MODEL,
                "messages": [
                    {"role": "system", "content": system_msg},
                    {"role": "user", "content": user_msg},
                ],
                "temperature": 0.2,
                "max_tokens": 8000,
            },
            timeout=45,
        )
        resp.raise_for_status()
        raw = resp.json()["choices"][0]["message"]["content"].strip()
        # Убираем markdown если есть
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1]
            raw = raw.rsplit("```", 1)[0]
        return json.loads(raw)
    except Exception as e:
        print(f"  LLM error: {type(e).__name__}: {str(e)[:100]}")
        return None


def main():
    # Backup JSONL
    import shutil
    shutil.copy(JSONL_PATH, BACKUP_PATH)
    print(f"Backup: {BACKUP_PATH}")

    # Загружаем все атомы
    atoms = []
    with open(JSONL_PATH, encoding="utf-8") as f:
        for line in f:
            if line.strip():
                atoms.append(json.loads(line))
    print(f"Загружено: {len(atoms)} атомов")

    # Находим пустые reference атомы
    empty = [
        a for a in atoms
        if a.get("atom_type") == "reference"
        and len((a.get("content") or "").strip()) < 80
        and not a.get("root_cause")
        and not (a.get("diagnostic_steps") or [])
    ]
    print(f"Пустых reference атомов для обогащения: {len(empty)}")

    # MongoDB
    col = MongoClient(MONGODB_URI)["autodiag"]["atoms"]

    # Индекс по id для быстрого обновления
    atom_index = {a.get("id"): i for i, a in enumerate(atoms)}

    total_enriched = 0
    total_batches = (len(empty) + BATCH_SIZE - 1) // BATCH_SIZE

    for batch_num, i in enumerate(range(0, len(empty), BATCH_SIZE), 1):
        batch = empty[i:i + BATCH_SIZE]

        # Разбиваем батч на DTC и осциллограммы
        dtc_batch = [a for a in batch if classify_atom(a) == "dtc"]
        osc_batch = [a for a in batch if classify_atom(a) == "oscillogram"]

        results_by_id = {}

        for sub_batch, atype in [(dtc_batch, "dtc"), (osc_batch, "oscillogram")]:
            if not sub_batch:
                continue
            descriptions = [build_atom_description(a, atype) for a in sub_batch]
            llm_results = call_llm(descriptions, atype)

            if llm_results and isinstance(llm_results, list):
                for item in llm_results:
                    if isinstance(item, dict) and item.get("id"):
                        results_by_id[item["id"]] = item

        # Применяем результаты
        enriched_in_batch = 0
        for atom in batch:
            atom_id = atom.get("id", "")
            enrichment = results_by_id.get(atom_id)
            if not enrichment:
                continue

            # Обновляем атом
            if enrichment.get("content"):
                atom["content"] = enrichment["content"]
            if enrichment.get("root_cause"):
                atom["root_cause"] = enrichment["root_cause"]
            if enrichment.get("symptoms"):
                atom["symptoms"] = enrichment["symptoms"]
            if enrichment.get("diagnostic_steps"):
                atom["diagnostic_steps"] = enrichment["diagnostic_steps"]

            # Обновляем в индексе
            idx = atom_index.get(atom_id)
            if idx is not None:
                atoms[idx] = atom

            # Обновляем MongoDB (без переэмбеддинга — эмбеддинг из заголовка достаточен)
            try:
                col.update_one(
                    {"id": atom_id},
                    {"$set": {
                        "content": atom.get("content", ""),
                        "root_cause": atom.get("root_cause", ""),
                        "symptoms": atom.get("symptoms", []),
                        "diagnostic_steps": atom.get("diagnostic_steps", []),
                    }}
                )
            except Exception as e:
                print(f"  MongoDB update error for {atom_id}: {e}")

            enriched_in_batch += 1

        total_enriched += enriched_in_batch
        pct = total_enriched / len(empty) * 100
        print(f"[{batch_num}/{total_batches}] +{enriched_in_batch} атомов | Итого: {total_enriched}/{len(empty)} ({pct:.1f}%)")

        time.sleep(DELAY)

    # Сохраняем обновлённый JSONL
    print(f"\nСохраняю обновлённый {JSONL_PATH}...")
    with open(JSONL_PATH, "w", encoding="utf-8") as f:
        for atom in atoms:
            f.write(json.dumps(atom, ensure_ascii=False) + "\n")

    print(f"\nГОТОВО! Обогащено: {total_enriched} из {len(empty)} атомов")
    print(f"Backup сохранён: {BACKUP_PATH}")


if __name__ == "__main__":
    main()
