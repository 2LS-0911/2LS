# Система логирования новых атомов в 2LS

## Что такое «атом»

Атом — минимальная единица знания в базе. Каждый атом описывает один диагностический случай, один DTC-код или один паттерн осциллограммы. Хранится в MongoDB (коллекция `atoms`) и в локальном файле `output/atoms_clean.jsonl` (единственный источник истины).

Текущий объём: **3 179 атомов** (из них 6 — китайские марки).

---

## Два независимых потока пополнения базы

```
Поток А (ручной/офлайн)          Поток Б (автоматический/онлайн)
─────────────────────────         ──────────────────────────────────
Исходники → pipeline.py           Механик проводит диагностику
      ↓                                     ↓
atoms_clean.jsonl                  POST /api/solve
      ↓                                     ↓
enrich_atoms.py (LLM)            cases_pending (MongoDB)
      ↓                                     ↓
import_mongo.py (embedding)       Менеджер аппрувит кейс
      ↓                           (ручная конвертация в атом — пока)
MongoDB Atlas (atoms)
```

---

## Поток А — подготовка атомов из внешних источников

### Шаг 1. Сбор исходников (`pipeline.py`)

Скрипт рекурсивно обходит `C:\dia`, определяет тип файла по расширению и запускает соответствующий обработчик:

| Тип файла | Что делает |
|-----------|------------|
| `.mp4`, `.mov`, видео | Транскрибирует речь → извлекает атомы |
| `.pdf`, `.docx` | Парсит текст → нарезает на атомы |
| `.md3`, `.mwf`, осциллограммы | Декодирует сигнал → описывает паттерн |
| `.jpg`, `.png` | Анализирует изображение через Vision LLM |

Каждый извлечённый атом записывается в `output/atoms/` (по одному `.json`) и в сводный `output/atoms.jsonl`. Попутно ведётся `manifest.json` — лог обработки каждого файла со статусом (`done` / `skipped` / `error`) и количеством атомов.

Формат одного атома из `pipeline.py`:
```json
{
  "id": "уникальный_id",
  "atom_type": "case | reference | oscillogram",
  "title": "...",
  "content": "...",
  "vehicle": { "make": "", "model": "", "year": "", "engine": "" },
  "symptoms": [...],
  "dtc_codes": [...],
  "diagnostic_steps": [...],
  "root_cause": "...",
  "parts_needed": [...],
  "tools_needed": [...],
  "source": { "file": "путь/к/исходнику", "type": "video|pdf|..." }
}
```

### Шаг 2. Обогащение пустых атомов (`enrich_atoms.py`)

Часть атомов после `pipeline.py` получается «пустыми»: есть заголовок и DTC-код, но нет `content`, `root_cause`, `diagnostic_steps`. Это типично для reference-атомов, сгенерированных из оглавления PDF или списка DTC.

`enrich_atoms.py` находит такие атомы (`atom_type == "reference"`, `content < 80 символов`, нет `root_cause`) и батчами по 10 штук отправляет их в **Gemini 2.5 Flash Lite** через OpenRouter.

LLM возвращает JSON-массив с полями: `content`, `root_cause`, `symptoms`, `diagnostic_steps`.

Результат пишется:
- в память (`atoms[]` в Python)
- в MongoDB `atoms.update_one({"id": ...}, {"$set": {...}})` — без переэмбеддинга, старый вектор остаётся
- в `output/atoms_clean.jsonl` (перезапись всего файла, бэкап → `atoms_clean.jsonl.bak`)

### Шаг 3. Встраивание в MongoDB (`import_mongo.py`)

После того как атомы заполнены содержимым, им нужен вектор для семантического поиска.

`import_mongo.py`:
1. Читает `output/atoms_clean.jsonl` (все атомы)
2. Запрашивает у MongoDB список ID, у которых уже есть `embedding`
3. Фильтрует только **новые** атомы (разница множеств)
4. Батчами по 8 атомов отправляет текст в **Voyage AI** (`voyage-3`, `input_type="document"`)
5. Текст для эмбеддинга: `Title + Vehicle + Symptoms + DTC + Content` (первые 4000 символов)
6. Получив вектор, делает `replace_one({"id": ...}, atom, upsert=True)` — создаёт или обновляет документ в MongoDB с полем `embedding`
7. Между батчами пауза 21 секунду (лимит Voyage AI — 3 RPM)

После этого атом становится доступен для RAG-поиска через `$vectorSearch` (индекс `Diagnostik`).

---

## Поток Б — логирование кейсов от автосервисов

### Шаг 1. Начало сессии (списание кредита)

При нажатии «Начать диагностику» фронтенд вызывает:

```
POST /api/session/start  { "service_code": "svc_xxxxxxxx" }
```

Бэкенд:
- проверяет, что сервис существует и не заблокирован
- атомарно `$inc: { "credits": -1, "total_sessions": +1 }`
- возвращает `session_id`

С этого момента сессия считается оплаченной и открытой.

### Шаг 2. Диагностический диалог (`/api/chat`)

Каждое сообщение механика вызывает:

```
POST /api/chat
{
  "vehicle": { "brand": "", "model": "", "year": "", "engine": "" },
  "messages": [...история диалога...],
  "message": "текущее сообщение",
  "service_code": "svc_xxxxxxxx",
  "dtc_codes": ["P0420"],
  "symptoms": ["Check Engine", "Расход вырос"],
  "symptom_text": "описание от механика"
}
```

Внутри `/api/chat`:
1. **RAG-поиск**: сообщение механика → Voyage AI embed → `$vectorSearch` по 150 кандидатам → топ-20 → фильтр качества `_is_useful_atom()` → фильтр по марке → сортировка (`case`-атомы первыми) → топ-3 атома
2. **Промпт**: `SKILL_SYSTEM_PROMPT` + данные авто + DTC/симптомы (помечены «НЕ переспрашивай») + найденные атомы как контекст
3. **LLM**: Gemini 2.5 Pro через OpenRouter, `max_tokens: 4000`, `timeout: 120`
4. Ответ возвращается на фронт. **В MongoDB ничего не пишется на этом шаге** — диалог живёт только в памяти браузера.

### Шаг 3. Закрытие кейса (`/api/solve`)

После того как механик завершил диалог и подтвердил результат (экран «confirm»), фронтенд вызывает:

```
POST /api/solve
{
  "vehicle": { ... },
  "messages": [...полная история диалога...],
  "service_code": "svc_xxxxxxxx",
  "dtc_codes": ["P0420"],
  "symptoms": ["Check Engine"],
  "symptom_text": "...",
  "root_cause": "Отравленный катализатор",
  "ai_rating": 5,
  "tools_used": ["Сканер OBD2", "Мультиметр"],
  "ref_value": "Лямбда после катализатора копирует сигнал до",
  "no_answer": false,
  "client": { "name": "", "phone": "", "car": "", "labor_hours": "", "note": "" }
}
```

Бэкенд (`solve_endpoint`):
1. Резолвит `service_code` → `service_id` + `service_name` из коллекции `services`
2. DTC: берёт из `req.dtc_codes`, при отсутствии — парсит regex `[PBCU][0-9]{4}` по всей истории сообщений
3. Пишет документ в коллекцию **`cases_pending`**:
   ```json
   {
     "case_id": "case_xxxxxxxx",
     "vehicle": { ... },
     "messages": [...],
     "service_id": "svc_...",
     "service_name": "...",
     "dtc_codes": [...],
     "symptoms": [...],
     "symptom_text": "...",
     "root_cause": "...",
     "ai_rating": 5,
     "tools_used": [...],
     "ref_value": "...",
     "no_answer": false,
     "status": "pending",
     "client": { ... },
     "created_at": "2026-06-12T..."
   }
   ```
4. Обновляет статистику сервиса: `$inc: { "solved_cases": +1 }`, пушит марку в `recent_brands`, DTC в `recent_dtcs`, обновляет `last_activity`
5. Если `no_answer: true` (AI признал нехватку данных) — статус кейса `"no_answer"` вместо `"pending"`

### Шаг 4. Ревью менеджером

Менеджер открывает список через:
```
GET /api/manager/cases   → все кейсы со статусом "pending"
```

После проверки:
```
POST /api/manager/approve/{case_id}   → { "status": "approved" }
```

На этом шаге кейс считается верифицированным и готовым к превращению в атом.

### Шаг 5. Конвертация кейса в атом (ручная, пока не автоматизирована)

Верифицированный кейс в `cases_pending` является «сырым материалом» для нового атома. Текущий процесс:
- Администратор вручную извлекает данные из `cases_pending`
- Форматирует в структуру атома (тип `"case"`)
- Добавляет строку в `output/atoms_clean.jsonl`
- Запускает `import_mongo.py` → атом получает эмбеддинг и попадает в `atoms`

Автоматизация этого шага (auto-approve → auto-atom) **запланирована, но не реализована**.

---

## Фильтр качества при поиске (`_is_useful_atom`)

При каждом RAG-запросе атомы прогоняются через фильтр. Атом считается бесполезным если:
- `content` меньше 80 символов
- нет `root_cause` / `verdict`, нет `diagnostic_steps`, нет `symptoms`
- в тексте есть фразы-маркеры мусора: `"лишь заголовком"`, `"рекламным"`, `"невозможно извлечь"` и т.д.

Такие атомы отфильтровываются до показа механику.

---

## Схема всего цикла (end-to-end)

```
Исходники (PDF/видео/осц.)
         ↓ pipeline.py
  atoms_clean.jsonl (сырые атомы)
         ↓ enrich_atoms.py (Gemini Flash Lite)
  atoms_clean.jsonl (обогащённые атомы)
         ↓ import_mongo.py (Voyage AI voyage-3)
  MongoDB Atlas / atoms (с эмбеддингами)
         ↓
  $vectorSearch — RAG-поиск при /api/chat
         ↓
  Gemini 2.5 Pro — ответ механику
         ↓
  Механик подтверждает диагноз → /api/solve
         ↓
  MongoDB Atlas / cases_pending (status: pending)
         ↓
  Менеджер аппрувит → status: approved
         ↓
  [Ручная конвертация] → atoms_clean.jsonl ← import_mongo.py
         ↓
  MongoDB Atlas / atoms (новый атом с эмбеддингом)
```

---

## Где живут данные

| Хранилище | Путь / коллекция | Что содержит |
|-----------|-----------------|--------------|
| Локальный файл | `C:\dia\output\atoms_clean.jsonl` | Единственный источник истины для атомов (3 199 строк) |
| MongoDB `atoms` | `autodiag.atoms` | Атомы с эмбеддингами для поиска (3 179 с эмбеддингом) |
| MongoDB `cases_pending` | `autodiag.cases_pending` | Кейсы от сервисов на модерации |
| MongoDB `services` | `autodiag.services` | Сервисы, кредиты, статистика |
| MongoDB `transactions` | `autodiag.transactions` | История пополнений кредитов |
