# Задание для AI-агента: Обогащение атомов DTC-кодами

## Контекст

В базе `output/atoms_clean.jsonl` ~360+ атомов. Проблема: коды ошибок (P0340, B1234, C0xxx…) встречаются в тексте атомов, но нет отдельного поля `dtc`. Sparse-поиск по запросу "P0340" не находит нужный атом, даже если код упомянут в `content`.

**Цель:** добавить поле `"dtc": ["P0340", ...]` в каждый атом, где есть DTC-код — и перезагрузить Qdrant.

## Жёсткие правила

1. НЕ ВЫДУМЫВАЙ вывод — показывай реальный.
2. СНАЧАЛА ПРОВЕРЬ наличие файлов.
3. ОСТАНОВИСЬ при неожиданных ошибках.
4. Сохраняй резервную копию atoms_clean.jsonl перед изменением.
5. Запускать из `C:\dia`, не из `C:\dia\output`.

---

## Часть A. Аудит: сколько атомов содержат DTC-коды

### A.1 Проверить наличие файлов

```powershell
# Из C:\dia
Test-Path output\atoms_clean.jsonl
python -c "import json; atoms=[json.loads(l) for l in open('output/atoms_clean.jsonl',encoding='utf-8')]; print('Атомов:', len(atoms))"
```

**Ожидается:** файл существует, атомов > 350.

### A.2 Найти все DTC-коды в базе

```powershell
python -c "
import json, re, sys
sys.stdout.reconfigure(encoding='utf-8')
atoms = [json.loads(l) for l in open('output/atoms_clean.jsonl', encoding='utf-8')]
DTC_RE = re.compile(r'\b([PBCU][0-9]{4})\b', re.IGNORECASE)
hits = {}
for a in atoms:
    text = ' '.join([
        a.get('title',''),
        a.get('content',''),
        str(a.get('reference_data',{})),
        str(a.get('review_notes','')),
    ])
    codes = list(set(DTC_RE.findall(text)))
    if codes:
        hits[a['id']] = codes
print(f'Атомов с DTC-кодами: {len(hits)}')
for aid, codes in sorted(hits.items()):
    print(f'  {aid}: {codes}')
"
```

**Покажи ПОЛНЫЙ вывод.** Если атомов с кодами < 5 — значит коды зарыты в видео-транскрипциях (тогда переходи к Части C после завершения транскрипции).

---

## Часть B. Добавить поле `dtc` в атомы

### B.1 Сделать резервную копию

```powershell
Copy-Item output\atoms_clean.jsonl output\atoms_clean_before_dtc.jsonl
Write-Host "Резервная копия: output\atoms_clean_before_dtc.jsonl"
```

### B.2 Скрипт обогащения

Создай файл `output/enrich_dtc.py`:

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json, re, sys
sys.stdout.reconfigure(encoding='utf-8')

ATOMS_FILE = "output/atoms_clean.jsonl"
DTC_RE = re.compile(r'\b([PBCU][0-9]{4})\b', re.IGNORECASE)

atoms = [json.loads(l) for l in open(ATOMS_FILE, encoding='utf-8')]

updated = 0
for a in atoms:
    text = ' '.join([
        a.get('title', ''),
        a.get('content', ''),
        str(a.get('reference_data', {})),
        str(a.get('review_notes', '')),
    ])
    codes = sorted(set(c.upper() for c in DTC_RE.findall(text)))
    if codes:
        a['dtc'] = codes
        updated += 1
    elif 'dtc' not in a:
        a['dtc'] = []

with open(ATOMS_FILE, 'w', encoding='utf-8') as f:
    for a in atoms:
        f.write(json.dumps(a, ensure_ascii=False) + '\n')

print(f"Обновлено: {updated} атомов с DTC-кодами")
print(f"Всего атомов: {len(atoms)}")
```

### B.3 Запустить

```powershell
cd C:\dia
python output\enrich_dtc.py
```

**Покажи вывод. Ожидается:** `Обновлено: N атомов с DTC-кодами`.

### B.4 Проверить результат

```powershell
python -c "
import json, sys
sys.stdout.reconfigure(encoding='utf-8')
atoms = [json.loads(l) for l in open('output/atoms_clean.jsonl', encoding='utf-8')]
with_dtc = [a for a in atoms if a.get('dtc')]
print(f'Атомов с непустым dtc: {len(with_dtc)}')
for a in with_dtc[:10]:
    print(f'  {a[\"id\"][:50]}: {a[\"dtc\"]}')
"
```

---

## Часть C. Обогащение из видео-транскрипций (если видео уже готовы)

Видео-атомы (тип `theory`, id начинается с `video_`) содержат лекционный текст, где могут упоминаться P-коды. Проверь:

```powershell
python -c "
import json, re, sys
sys.stdout.reconfigure(encoding='utf-8')
atoms = [json.loads(l) for l in open('output/atoms_clean.jsonl', encoding='utf-8')]
DTC_RE = re.compile(r'\b([PBCU][0-9]{4})\b', re.IGNORECASE)
video_atoms = [a for a in atoms if a.get('id','').startswith('video_') and a.get('content','')]
print(f'Видео-атомов с контентом: {len(video_atoms)}')
for a in video_atoms:
    codes = set(DTC_RE.findall(a.get('content','')))
    if codes:
        print(f'  {a[\"id\"]}: {sorted(codes)}')
"
```

Если видео-транскрипции ещё не готовы (атомов `video_` меньше 10) — **пропусти эту часть и вернись после завершения `transcribe_videos.py`.**

---

## Часть D. Обновить схему Qdrant (добавить DTC как payload-фильтр)

После обогащения атомов нужно перезагрузить коллекцию в Qdrant.

### D.1 Запустить Docker Qdrant (если не запущен)

```powershell
docker start qdrant
Start-Sleep -Seconds 3
Invoke-RestMethod http://localhost:6333/ | Select-Object -ExpandProperty title
```

**Ожидается:** `Qdrant - vector search engine`

### D.2 Перезагрузить коллекцию

```powershell
cd C:\dia
python output\qdrant_pilot.py
```

Это пересоздаёт коллекцию `autoelectric` с нуля и загружает все атомы с `confidence in (high, medium)`.

**Покажи ПОЛНЫЙ вывод. Ожидается:** `Загружено N атомов` где N > 97 (больше чем до vision pass).

### D.3 Тест поиска по DTC

Добавь временный тест-запрос вручную:

```powershell
python -c "
import sys; sys.stdout.reconfigure(encoding='utf-8')
from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchAny
client = QdrantClient('localhost', port=6333)

# Поиск по фильтру dtc
results = client.scroll(
    collection_name='autoelectric',
    scroll_filter=Filter(must=[
        FieldCondition(key='dtc', match=MatchAny(any=['P0340']))
    ]),
    limit=10,
    with_payload=True
)
print('Атомы с P0340:')
for r in results[0]:
    print(f'  {r.payload.get(\"id\")} | {r.payload.get(\"title\")}')
"
```

---

## Часть E. Итоговый отчёт

Сохрани в `output/DTC_ENRICH_REPORT.md`:

```markdown
# Отчёт: Обогащение DTC-кодами
Дата: <дата>

## Результаты
- Атомов с DTC до: 0 (поля не было)
- Атомов с DTC после: N
- Уникальных DTC-кодов найдено: M
- Список всех кодов: P0xxx, P0yyy...

## Из видео-транскрипций
- Видео-атомов проверено: K
- Видео-атомов с кодами: L

## Qdrant после перезагрузки
- Атомов загружено: N
- Тест фильтра по P0340: <результат>

## Проблемы
(если были)
```

**Задание завершено.**

---

## Справка: когда запускать

| Условие | Действие |
|---------|----------|
| Vision pass завершён (`output/vision_pass.log` показывает `275/275`) | Запускай Части A–B–D |
| Транскрипция завершена (`video_transcribe.log` показывает `14/14`) | Добавь Часть C, затем D |
| Оба завершены | Запускай A → B → C → D → E |

**Проверка статуса перед запуском:**
```powershell
Get-Content output\vision_pass.log -Tail 3
Get-Content output\video_transcribe.log -Tail 3
Get-Process python* | Select-Object Id, CPU
```
