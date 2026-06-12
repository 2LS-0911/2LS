"""
AutoDiag API — FastAPI backend для Telegram Mini App
Поиск в MongoDB Atlas через Voyage AI embeddings
"""

import os
import logging
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pymongo import MongoClient
import voyageai
from dotenv import load_dotenv

# Читаем из c:\dia\.env (единый файл всех секретов)
load_dotenv(r"C:\dia\.env")
# Fallback на старый путь
load_dotenv(r"C:\dia\manufacturing-car-manual-RAG\backend\.env")

MONGODB_URI = os.getenv("MONGODB_URI")
VOYAGE_API_KEY = os.getenv("VOYAGE_API_KEY")
DB_NAME = os.getenv("DATABASE_NAME", "autodiag")
COLLECTION = "atoms"
VECTOR_INDEX = "Diagnostik"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

mongo_client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
db = mongo_client[DB_NAME]
collection = db[COLLECTION]
voyage_client = voyageai.Client(api_key=VOYAGE_API_KEY)

app = FastAPI(title="AutoDiag API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Pydantic models ────────────────────────────────────────────────

class DiagnoseRequest(BaseModel):
    brand: str = ""
    model: str = ""
    year: Optional[int] = None
    engine: str = ""
    symptom: str = ""
    dtc: str = ""

class RefineRequest(BaseModel):
    original_query: str
    refine_query: str
    brand: str = ""

class TechStep(BaseModel):
    id: int
    title: str
    description: str
    tools: list[str]
    tips: str
    customDiagramId: Optional[str] = None

class PartItem(BaseModel):
    name: str
    sku: str
    quantity: int
    estimatedCost: str

class DiagnosticResult(BaseModel):
    id: str
    brand: str
    model: str
    year: int
    engine: str
    symptom: str
    dtc: str
    mainCause: str
    confidence: int
    steps: list[TechStep]
    parts: list[PartItem]
    source: str = ""


# ── MongoDB vector search ─────────────────────────────────────────

def search_atoms(query_text: str, make: str = None, limit: int = 5) -> list[dict]:
    try:
        result = voyage_client.embed([query_text], model="voyage-3", input_type="query")
        query_vector = result.embeddings[0]

        pipeline = [
            {
                "$vectorSearch": {
                    "index": VECTOR_INDEX,
                    "path": "embedding",
                    "queryVector": query_vector,
                    "numCandidates": 150,
                    "limit": 20,
                }
            },
            {
                "$project": {
                    "id": 1, "atom_type": 1, "title": 1, "content": 1,
                    "symptom": 1, "symptoms": 1, "dtc_codes": 1, "dtc": 1,
                    "vehicle": 1, "system": 1,
                    "diagnostic_steps": 1, "diagnostic_sequence": 1,
                    "root_cause": 1, "verdict": 1, "solution": 1,
                    "parts": 1, "parts_needed": 1, "tools_needed": 1,
                    "source": 1, "confidence": 1,
                    "score": {"$meta": "vectorSearchScore"},
                    "_id": 0,
                }
            },
        ]

        results = list(collection.aggregate(pipeline))

        if make and results:
            make_lower = make.lower()
            filtered = [
                r for r in results
                if make_lower in str(r.get("vehicle", "")).lower()
                or make_lower in str(r.get("title", "")).lower()
            ]
            results = filtered if filtered else results

        return results[:limit]

    except Exception as e:
        logger.error(f"Search error: {type(e).__name__}: {e}", exc_info=True)
        return []


# ── Atom → DiagnosticResult mapper ───────────────────────────────

def _extract_vehicle(atom: dict) -> tuple[str, str, int, str]:
    v = atom.get("vehicle", {})
    if isinstance(v, dict):
        make = v.get("make") or ""
        model = v.get("model") or ""
        year = v.get("year") or 0
        engine = v.get("engine") or ""
    else:
        # autodata-style: "Toyota Vitz (1KR-FE)"
        v_str = str(v)
        parts = v_str.replace("(", " ").replace(")", "").split()
        make = parts[0] if parts else ""
        model = parts[1] if len(parts) > 1 else ""
        engine = parts[2] if len(parts) > 2 else ""
        year = 0

    return make, model, int(year) if year else 0, engine


def _extract_steps(atom: dict) -> list[TechStep]:
    steps = []

    # Формат 1: diagnostic_steps — список dict {action, measurement, expected, result}
    raw_steps = atom.get("diagnostic_steps") or []
    if raw_steps and isinstance(raw_steps[0], dict):
        for i, s in enumerate(raw_steps[:5], start=1):
            action = s.get("action", "")
            measurement = s.get("measurement", "")
            expected = s.get("expected", "")
            result_txt = s.get("result", "")
            description = action
            if measurement:
                description += f"\nЗамер: {measurement}"
            if expected:
                description += f"\nНорма: {expected}"
            tips = result_txt or "Сравните результат с нормой."
            steps.append(TechStep(
                id=i,
                title=action[:80] if action else f"Шаг {i}",
                description=description,
                tools=atom.get("tools_needed") or [],
                tips=tips,
            ))
        return steps

    # Формат 2: diagnostic_sequence — список строк
    raw_seq = atom.get("diagnostic_sequence") or []
    if not raw_seq and isinstance(raw_steps, list) and raw_steps and isinstance(raw_steps[0], str):
        raw_seq = raw_steps
    if raw_seq:
        for i, s in enumerate(raw_seq[:5], start=1):
            steps.append(TechStep(
                id=i,
                title=s[:80],
                description=s,
                tools=atom.get("tools_needed") or [],
                tips="Выполните шаг и сверьте результат с нормативом.",
            ))
        return steps

    # Формат 3: нет шагов — используем content как единственный шаг
    content = atom.get("content") or ""
    if content:
        # Разбиваем длинный content на 2-3 куска по абзацам
        paragraphs = [p.strip() for p in content.split("\n") if p.strip()]
        if len(paragraphs) <= 1:
            # Split by sentences if one big block
            import re
            sentences = re.split(r'(?<=[.!?])\s+', content)
            mid = len(sentences) // 2
            paragraphs = [" ".join(sentences[:mid]), " ".join(sentences[mid:])]
            paragraphs = [p for p in paragraphs if p]

        tools = atom.get("tools_needed") or []
        for i, para in enumerate(paragraphs[:3], start=1):
            steps.append(TechStep(
                id=i,
                title=f"Диагностика: шаг {i}",
                description=para,
                tools=tools,
                tips="Фиксируйте результаты каждого шага для точной диагностики.",
            ))

    if not steps:
        steps.append(TechStep(
            id=1,
            title="Визуальный осмотр и начальная диагностика",
            description="Проведите визуальный осмотр агрегата. Проверьте наличие явных повреждений, утечек, нагара. Подключите сканер и считайте все коды ошибок.",
            tools=["Мультиметр", "OBD2 сканер"],
            tips="Начинайте диагностику всегда с простого — визуального осмотра и чтения кодов.",
        ))

    return steps


def _extract_parts(atom: dict) -> list[PartItem]:
    raw = atom.get("parts") or atom.get("parts_needed") or []
    result = []
    for i, p in enumerate(raw[:6]):
        if isinstance(p, dict):
            name = p.get("name", f"Запчасть {i+1}")
            sku = p.get("part_number") or p.get("sku") or "—"
        else:
            name = str(p)
            sku = "—"
        result.append(PartItem(
            name=name,
            sku=sku,
            quantity=1,
            estimatedCost="по запросу",
        ))
    return result


def _extract_main_cause(atom: dict) -> str:
    for field in ("root_cause", "verdict", "solution"):
        v = atom.get(field)
        if v and isinstance(v, str) and len(v) > 10:
            return v
    content = atom.get("content") or ""
    if content:
        return content[:200] + ("..." if len(content) > 200 else "")
    return atom.get("title", "Требуется детальная диагностика.")


def _score_to_confidence(score: float) -> int:
    # vectorSearchScore обычно 0.7–1.0; нормализуем в 60–98
    pct = int(score * 100)
    return max(55, min(98, pct))


def atom_to_result(atom: dict, req: DiagnoseRequest) -> DiagnosticResult:
    make, model, year, engine = _extract_vehicle(atom)

    # Если пользователь указал данные — используем их
    brand_out = req.brand or make or "Универсально"
    model_out = req.model or model or ""
    year_out = req.year or year or 0
    engine_out = req.engine or engine or ""

    symptom_out = req.symptom or (
        atom.get("symptom") or
        ", ".join(atom.get("symptoms") or []) or
        atom.get("title", "")
    )

    dtc_out = req.dtc or ", ".join(
        atom.get("dtc_codes") or atom.get("dtc") or []
    )

    source_info = atom.get("source", {})
    source_str = ""
    if isinstance(source_info, dict):
        src_file = source_info.get("file", "")
        if "autodata" in str(src_file).lower():
            source_str = "Autodata.ru"
        elif src_file:
            source_str = "Видеокурс / PDF"
    elif isinstance(source_info, str):
        source_str = source_info

    return DiagnosticResult(
        id=atom.get("id", "unknown"),
        brand=brand_out,
        model=model_out,
        year=year_out,
        engine=engine_out,
        symptom=symptom_out,
        dtc=dtc_out,
        mainCause=_extract_main_cause(atom),
        confidence=_score_to_confidence(atom.get("score", 0.75)),
        steps=_extract_steps(atom),
        parts=_extract_parts(atom),
        source=source_str,
    )


# ── Routes ────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    try:
        count = collection.count_documents({"embedding": {"$exists": True}})
        return {"status": "ok", "atoms_with_embeddings": count}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@app.post("/api/diagnose", response_model=list[DiagnosticResult])
def diagnose(req: DiagnoseRequest):
    if not req.symptom and not req.dtc:
        raise HTTPException(status_code=400, detail="Укажите симптомы или код ошибки DTC")

    # Строим поисковый запрос
    parts = []
    if req.brand:
        parts.append(req.brand)
    if req.model:
        parts.append(req.model)
    if req.engine:
        parts.append(req.engine)
    if req.dtc:
        parts.append(req.dtc)
    if req.symptom:
        parts.append(req.symptom)

    query = " ".join(parts)
    make = req.brand if req.brand and req.brand not in ("Любая", "any") else None

    atoms = search_atoms(query, make=make, limit=3)

    if not atoms:
        # Повтор без фильтра по марке
        atoms = search_atoms(query, make=None, limit=3)

    if not atoms:
        raise HTTPException(status_code=404, detail="Ничего не найдено. Попробуйте изменить запрос.")

    results = []
    for a in atoms:
        try:
            results.append(atom_to_result(a, req))
        except Exception as e:
            logger.error(f"atom_to_result failed for {a.get('id')}: {e}", exc_info=True)
    if not results:
        raise HTTPException(status_code=500, detail="Ошибка обработки результатов.")
    return results


@app.post("/api/refine", response_model=DiagnosticResult)
def refine(req: RefineRequest):
    combined = f"{req.original_query} {req.refine_query}"
    make = req.brand if req.brand and req.brand not in ("Любая", "any") else None

    atoms = search_atoms(combined, make=make, limit=1)
    if not atoms:
        atoms = search_atoms(combined, make=None, limit=1)
    if not atoms:
        raise HTTPException(status_code=404, detail="Уточняющий запрос не дал результатов.")

    dummy_req = DiagnoseRequest(brand=req.brand, symptom=req.refine_query)
    return atom_to_result(atoms[0], dummy_req)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
