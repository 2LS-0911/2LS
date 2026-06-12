#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Qdrant-пилот: загрузка чистых атомов + гибридный поиск (dense + sparse + фильтры).

Требования:
  pip install qdrant-client[fastembed]
  Docker: docker run -d -p 6333:6333 -v $(pwd)/qdrant_data:/qdrant/storage qdrant/qdrant

Запуск:
  python3 qdrant_pilot.py load              # загрузить атомы в Qdrant
  python3 qdrant_pilot.py search "запрос"   # поиск
  python3 qdrant_pilot.py test              # прогнать тестовые запросы
  python3 qdrant_pilot.py stats             # статистика коллекции
"""

import json, sys, os
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

from qdrant_client import QdrantClient, models

# ================= НАСТРОЙКИ =================

QDRANT_URL = "http://localhost:6333"
COLLECTION = "autoelectric"
ATOMS_FILE = "output/atoms_clean.jsonl"

# Модели FastEmbed (скачаются автоматически при первом запуске)
DENSE_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"  # 384 dims, хороший русский
SPARSE_MODEL = "Qdrant/bm42-all-minilm-l6-v2-attentions"  # sparse для точных совпадений

# Фильтр: грузим атомы с high/medium confidence (пилот — берём больше данных)
LOAD_FILTER = lambda a: (
    a.get("confidence") in ("high", "medium")
)

# ================= ПОДГОТОВКА ТЕКСТА ДЛЯ ЭМБЕДДИНГА =================

def atom_to_search_text(atom):
    """Собирает из атома текст, по которому будем искать."""
    parts = []
    t = atom.get("atom_type", "")

    # Заголовок всегда
    if atom.get("title"):
        parts.append(atom["title"])

    # Для case: симптом + причина + решение
    if t == "case":
        if atom.get("symptom"): parts.append(atom["symptom"])
        if atom.get("root_cause"): parts.append(atom["root_cause"])
        if atom.get("solution"): parts.append(atom["solution"])
        for step in (atom.get("diagnostic_steps") or []):
            if step.get("action"): parts.append(step["action"])
            if step.get("measurement"): parts.append(step["measurement"])

    # Для theory/procedure: content
    elif t in ("theory", "procedure"):
        if atom.get("content"):
            # Обрезаем до 500 символов для эмбеддинга (полный текст в payload)
            parts.append(atom["content"][:500])

    # Для reference: описание формы / распиновки
    elif t == "reference":
        rd = atom.get("reference_data") or {}
        if rd.get("shape_description"):
            parts.append(rd["shape_description"])
        if rd.get("kind") == "pinout" and rd.get("pins"):
            for pin in rd["pins"][:10]:
                parts.append(f"пин {pin.get('pin','')} {pin.get('circuit','')} {pin.get('function','')}")

    # DTC коды (важно для sparse-поиска!)
    for code in (atom.get("dtc_codes") or []):
        parts.append(code)

    # Марка/модель (vehicle может быть строкой или словарём)
    v = atom.get("vehicle") or {}
    if isinstance(v, str):
        if v: parts.append(v)
    else:
        if v.get("make"): parts.append(v["make"])
        if v.get("model"): parts.append(v["model"])

    text = " . ".join(p for p in parts if p)
    return text if text.strip() else atom.get("id", "unknown")


def atom_to_payload(atom):
    """Payload для фильтрации (не для поиска — для фильтров и отображения)."""
    v = atom.get("vehicle") or {}
    rd = atom.get("reference_data") or {}
    if isinstance(v, str):
        v_make = v
        v_model = ""
        v_year_from = 0
        v_year_to = 0
        v_engine = ""
    else:
        v_make = v.get("make") or ""
        v_model = v.get("model") or ""
        v_year_from = int(v.get("year_from") or 0)
        v_year_to = int(v.get("year_to") or 0)
        v_engine = v.get("engine") or ""
    return {
        "id": atom.get("id", ""),
        "atom_type": atom.get("atom_type", ""),
        "title": atom.get("title", ""),
        "system": atom.get("system", ""),
        "confidence": atom.get("confidence", ""),
        "vehicle_make": v_make,
        "vehicle_model": v_model,
        "vehicle_year_from": v_year_from,
        "vehicle_year_to": v_year_to,
        "vehicle_engine": v_engine,
        "dtc_codes": atom.get("dtc_codes") or [],
        "verdict": rd.get("verdict") or atom.get("verdict") or "",
        "symptoms": atom.get("symptoms") or [],
        "source_file": (atom.get("source") or {}).get("file", ""),
        "source_locator": (atom.get("source") or {}).get("locator", ""),
        "image": atom.get("image") or "",
        "content_full": (atom.get("content") or "")[:2000],
        "symptom": atom.get("symptom") or "",
        "root_cause": atom.get("root_cause") or "",
        "solution": atom.get("solution") or "",
        "shape_description": rd.get("shape_description") or "",
    }


# ================= КОМАНДЫ =================

def cmd_load():
    """Загрузить атомы в Qdrant."""
    # Подключение
    client = QdrantClient(url=QDRANT_URL)
    print(f"Подключено к Qdrant: {QDRANT_URL}")

    # Загрузка атомов
    atoms = [json.loads(l) for l in open(ATOMS_FILE, encoding='utf-8')]
    clean = [a for a in atoms if LOAD_FILTER(a)]
    print(f"Атомов в файле: {len(atoms)}, прошли фильтр: {len(clean)}")

    if not clean:
        print("❌ Нет атомов для загрузки! Проверь фильтр и atoms_clean.jsonl.")
        return

    # Тексты для эмбеддинга
    texts = [atom_to_search_text(a) for a in clean]
    payloads = [atom_to_payload(a) for a in clean]

    # Удалить старую коллекцию если есть
    try:
        client.delete_collection(COLLECTION)
        print(f"Удалена старая коллекция '{COLLECTION}'")
    except Exception:
        pass

    # Создать коллекцию с dense + sparse
    client.create_collection(
        collection_name=COLLECTION,
        vectors_config={
            "dense": models.VectorParams(
                size=384,  # paraphrase-multilingual-MiniLM-L12-v2
                distance=models.Distance.COSINE,
            )
        },
        sparse_vectors_config={
            "sparse": models.SparseVectorParams(
                modifier=models.Modifier.IDF,  # BM42-style IDF weighting
            )
        },
    )

    # Создать индексы для фильтрации
    for field, schema in [
        ("atom_type", models.PayloadSchemaType.KEYWORD),
        ("system", models.PayloadSchemaType.KEYWORD),
        ("vehicle_make", models.PayloadSchemaType.KEYWORD),
        ("vehicle_model", models.PayloadSchemaType.KEYWORD),
        ("vehicle_engine", models.PayloadSchemaType.KEYWORD),
        ("vehicle_year_from", models.PayloadSchemaType.INTEGER),
        ("vehicle_year_to", models.PayloadSchemaType.INTEGER),
        ("confidence", models.PayloadSchemaType.KEYWORD),
        ("verdict", models.PayloadSchemaType.KEYWORD),
        ("dtc_codes", models.PayloadSchemaType.KEYWORD),
    ]:
        client.create_payload_index(COLLECTION, field, schema)

    print(f"Коллекция '{COLLECTION}' создана. Генерирую эмбеддинги...")

    # Эмбеддинги через FastEmbed
    from fastembed import TextEmbedding, SparseTextEmbedding

    dense_model = TextEmbedding(DENSE_MODEL)
    sparse_model = SparseTextEmbedding(SPARSE_MODEL)

    dense_vecs = list(dense_model.embed(texts))
    sparse_vecs = list(sparse_model.embed(texts))

    print(f"Эмбеддинги готовы: {len(dense_vecs)} dense, {len(sparse_vecs)} sparse")

    # Upsert
    points = []
    for i, (atom, dvec, svec, payload) in enumerate(zip(clean, dense_vecs, sparse_vecs, payloads)):
        points.append(models.PointStruct(
            id=i,
            vector={
                "dense": dvec.tolist(),
                "sparse": models.SparseVector(
                    indices=svec.indices.tolist(),
                    values=svec.values.tolist(),
                ),
            },
            payload=payload,
        ))

    # Батчевая загрузка
    BATCH = 64
    for start in range(0, len(points), BATCH):
        batch = points[start:start + BATCH]
        client.upsert(COLLECTION, batch)

    print(f"\n✅ Загружено {len(points)} атомов в '{COLLECTION}'")
    cmd_stats()


def cmd_search(query, system_filter=None, make_filter=None, model_filter=None,
               year_filter=None, engine_filter=None, top_k=5):
    """Гибридный поиск: dense + sparse + фильтры + RRF fusion.

    year_filter: int — год выпуска автомобиля (ищем атомы где year_from <= year <= year_to)
    engine_filter: str — двигатель (ключевое слово, совпадение в vehicle_engine)
    """
    client = QdrantClient(url=QDRANT_URL)
    from fastembed import TextEmbedding, SparseTextEmbedding

    dense_model = TextEmbedding(DENSE_MODEL)
    sparse_model = SparseTextEmbedding(SPARSE_MODEL)

    # Эмбеддинг запроса
    q_dense = list(dense_model.embed([query]))[0].tolist()
    q_sparse_raw = list(sparse_model.embed([query]))[0]

    # Фильтр
    conditions = []
    if system_filter:
        conditions.append(models.FieldCondition(key="system", match=models.MatchValue(value=system_filter)))
    if make_filter:
        conditions.append(models.FieldCondition(key="vehicle_make", match=models.MatchValue(value=make_filter)))
    if model_filter:
        conditions.append(models.FieldCondition(key="vehicle_model", match=models.MatchValue(value=model_filter)))
    if year_filter:
        # Атом подходит если year_from <= year_filter (или year_from=0) И year_to >= year_filter (или year_to=0)
        conditions.append(models.Filter(
            should=[
                models.Filter(must=[
                    models.FieldCondition(key="vehicle_year_from", range=models.Range(lte=year_filter)),
                    models.Filter(should=[
                        models.FieldCondition(key="vehicle_year_to", range=models.Range(gte=year_filter)),
                        models.FieldCondition(key="vehicle_year_to", match=models.MatchValue(value=0)),
                    ])
                ]),
                models.FieldCondition(key="vehicle_year_from", match=models.MatchValue(value=0)),
            ]
        ))
    if engine_filter:
        conditions.append(models.FieldCondition(key="vehicle_engine", match=models.MatchText(text=engine_filter)))

    query_filter = models.Filter(must=conditions) if conditions else None

    # Гибридный поиск через prefetch + RRF
    results = client.query_points(
        collection_name=COLLECTION,
        prefetch=[
            models.Prefetch(
                query=q_dense,
                using="dense",
                limit=20,
                filter=query_filter,
            ),
            models.Prefetch(
                query=models.SparseVector(
                    indices=q_sparse_raw.indices.tolist(),
                    values=q_sparse_raw.values.tolist(),
                ),
                using="sparse",
                limit=20,
                filter=query_filter,
            ),
        ],
        query=models.FusionQuery(fusion=models.Fusion.RRF),
        limit=top_k,
    )

    return results.points


def cmd_search_print(query, **kwargs):
    """Поиск с красивым выводом."""
    print(f"\n{'='*60}")
    print(f"ЗАПРОС: {query}")
    if kwargs:
        print(f"ФИЛЬТРЫ: {kwargs}")
    print(f"{'='*60}")

    results = cmd_search(query, **kwargs)
    if not results:
        print("❌ Ничего не найдено")
        return

    for i, r in enumerate(results):
        p = r.payload
        print(f"\n--- Результат #{i+1} (score: {r.score:.4f}) ---")
        print(f"  Тип: {p.get('atom_type')}  |  Система: {p.get('system')}  |  Уверенность: {p.get('confidence')}")
        print(f"  Заголовок: {p.get('title')}")
        # Расширенный vehicle
        vparts = [p.get('vehicle_make',''), p.get('vehicle_model','')]
        yf, yt = p.get('vehicle_year_from',0), p.get('vehicle_year_to',0)
        if yf: vparts.append(f"{yf}-{yt}" if yt else str(yf))
        if p.get('vehicle_engine'): vparts.append(p['vehicle_engine'])
        vstr = ' '.join(x for x in vparts if x)
        if vstr.strip():
            print(f"  Машина: {vstr}")
        if p.get("symptoms"):
            syms = p["symptoms"] if isinstance(p["symptoms"], list) else [p["symptoms"]]
            print(f"  Симптомы: {', '.join(syms[:3])}")
        if p.get("verdict"):
            print(f"  Вердикт: {p.get('verdict')}")
        if p.get("symptom"):
            print(f"  Симптом: {p.get('symptom')}")
        if p.get("root_cause"):
            print(f"  Причина: {p.get('root_cause')}")
        if p.get("solution"):
            print(f"  Решение: {p.get('solution')}")
        if p.get("shape_description"):
            print(f"  Форма: {p.get('shape_description')[:200]}...")
        if p.get("content_full"):
            print(f"  Содержание: {p.get('content_full')[:200]}...")
        if p.get("image"):
            print(f"  Картинка: {p.get('image')}")
        print(f"  Источник: {p.get('source_file','?')} [{p.get('source_locator','')}]")


def cmd_test():
    """Тестовые запросы — проверка гибридного поиска."""
    tests = [
        # Семантический поиск по симптому
        {"query": "нет искры, стартер крутит, не заводится"},
        # Точный поиск по DTC коду (sparse должен помочь)
        {"query": "P0340 ошибка датчик распредвала"},
        # Поиск эталонной осциллограммы
        {"query": "первичка зажигания COP норма эталон"},
        # Поиск по дефекту осциллограммы
        {"query": "дефект катушки зажигания нет линии горения"},
        # Поиск процедуры
        {"query": "как снять осциллограмму давления в цилиндре"},
        # Поиск теории
        {"query": "напряжение пробоя искрового промежутка от чего зависит"},
        # Поиск по марке
        {"query": "Chevrolet Cobalt нестабильный холостой ход"},
        # Поиск по системе с фильтром
        {"query": "ДПДЗ неисправность залип", "system_filter": "питание"},
        # Поиск распиновки/датчика
        {"query": "ДПКВ датчик коленвала проверка"},
        # Поиск давления в цилиндре
        {"query": "забитый катализатор давление выпуска норма"},
    ]

    for t in tests:
        cmd_search_print(**t)


def cmd_stats():
    """Статистика коллекции."""
    client = QdrantClient(url=QDRANT_URL)
    info = client.get_collection(COLLECTION)
    print(f"\n📊 Коллекция '{COLLECTION}':")
    print(f"   Точек: {info.points_count}")
    print(f"   Статус: {info.status}")


# ================= MAIN =================

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd == "load":
        cmd_load()
    elif cmd == "search":
        query = " ".join(sys.argv[2:])
        cmd_search_print(query)
    elif cmd == "test":
        cmd_test()
    elif cmd == "stats":
        cmd_stats()
    else:
        print(f"Неизвестная команда: {cmd}")
        print(__doc__)
