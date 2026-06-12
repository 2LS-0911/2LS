# CLAUDE.md — 2LS: AI-диагност для автосервисов

Проект: Telegram Mini App — диалоговый AI-диагност для механиков на базе RAG + LLM.  
Компания: **2LS** (переименована из AutoDiag).  
Рабочая директория: `C:\dia`  
Shell: PowerShell (Windows 10). Скрипты запускать из `C:\dia`.

---

## Концепция продукта (финальная)

**Ядро продукта** — файл `c:\dia\auto-diagnostics.skill`. Вся логика приложения строится на нём.

### Поток пользователя (5 экранов):
1. **Экран "code"** — ввод кода сервиса (`svc_xxxxxxxx`), проверка кредитов.
2. **Экран "form"** — Марка / Модель / Год / Двигатель. Переключатель **Обычные / 🇨🇳 Китайские** — разные списки марок, каскадные модели и двигатели для обоих.
3. **Экран "problem"** — DTC-код (или "Нет кода") + чипы симптомов + текст описания. Кнопка активна только когда заполнено.
4. **Экран "chat"** — AI сразу отвечает первым (автовызов `/api/chat` при открытии). Отправка только кнопкой (Enter не отправляет — защита от случайного нажатия).
5. **Экран "confirm"** — звёзды AI, причина (обязательно), инструменты, эталонное значение (+1 кредит), **данные клиента для PDF** (имя, телефон, авто, нормачасы, рекомендация).
6. **Экран "solved"** — кейс сохранён. Если заполнены данные клиента → кнопка **"Скачать акт PDF"**.

### PDF-генерация (client-side, без зависимостей):
- Функция `generatePDF()` в `App.tsx` создаёт HTML-страницу с фирменным бланком 2LS.
- Открывает `window.open()` → автоматически вызывает `window.print()` → пользователь сохраняет PDF.
- Содержит: данные клиента, авто, DTC, симптомы, диагноз, заключение AI, нормачасы, строки для подписей.
- Показывается только если заполнено имя клиента и причина неисправности.

### Документы для клиента (реализованы / запланированы):
- ✅ **Акт диагностики** (PDF) — текущая реализация
- 🔜 **Заказ-наряд** — перечень работ + запчасти + стоимость + подпись (юридически обязательный в РФ)
- 🔜 **Гарантийный талон** — 30/60/90 дней на выполненные работы
- 🔜 **Рекомендации по ТО** — следующий визит через N км / месяцев
- 🔜 **История ремонтов** — QR-код или ссылка по VIN

### Формат ответов AI (по скиллу):
- Никаких `#` заголовков и таблиц (Telegram не рендерит).
- `*жирный*` для подписей блоков.
- Короткие абзацы, шаги — отдельными строками.
- Никогда не выдумывать точные значения — давать метод определения.

---

## Архитектура (текущий стек)

```
CarCar/
├── api/
│   └── index.py              — FastAPI бэкенд (RAG + LLM + MongoDB + биллинг)
├── src/
│   ├── data/
│   │   ├── vehicleData.ts    — VEHICLE_DATA (обычные) + CHINESE_VEHICLE_DATA (15 китайских брендов) + getModels/getEngines
│   │   └── presets.ts        — CAR_BRANDS (обычные марки)
│   ├── App.tsx               — 5 экранов + generatePDF()
│   ├── AdminPanel.tsx        — Панель администратора
│   ├── RepDashboard.tsx      — Кабинет представителя
│   ├── main.tsx
│   └── index.css
├── .env                      — Секреты (не в git)
├── vercel.json               — Деплой конфиг
├── requirements.txt
└── README.md
```

**Стек:** React/Vite (фронт) + FastAPI (бэк) + MongoDB Atlas (хранилище) + Voyage AI (эмбеддинги) + OpenRouter/Gemini 2.5 Pro (LLM)

### API эндпоинты:
| Метод | URL | Описание |
|-------|-----|----------|
| GET | `/api/health` | Статус бэкенда + кол-во атомов |
| POST | `/api/chat` | Диалог с AI по скиллу + RAG. Принимает `session_id`, пишет `rag_trace` в sessions |
| POST | `/api/solve` | Сохранение кейса + парсинг `[CASE_SUMMARY]` + авто-атомизация в `atoms_draft` |
| GET | `/api/service/credits` | Проверка кредитов сервиса по коду |
| POST | `/api/session/start` | Списание 1 кредита, создание документа в `sessions` |
| GET | `/api/manager/cases` | Список кейсов на проверку (`cases_pending`) |
| POST | `/api/manager/approve/{id}` | Утверждение кейса |
| GET | `/api/manager/drafts` | Черновики атомов (`atoms_draft`) для ревью |
| GET | `/api/manager/draft/{id}` | Черновик + исходный кейс рядом |
| POST | `/api/manager/draft/{id}/approve` | Одобрить черновик → атом в `atoms` с эмбеддингом |
| POST | `/api/manager/draft/{id}/reject` | Отклонить черновик с причиной |
| GET | `/api/manager/sessions` | Список сессий (аналитика брошенных) |
| GET/POST/PUT/DELETE | `/api/admin/service/...` | CRUD сервисов |
| GET/POST/PUT/DELETE | `/api/admin/rep/...` | CRUD представителей |
| POST | `/api/admin/credits` | Пополнение кредитов сервису |
| GET | `/api/admin/service/{id}/analytics` | Аналитика по сервису |
| GET | `/api/rep/dashboard` | Кабинет представителя |

### Логика `/api/chat` (v2):
1. RAG-поиск по сообщению (Voyage AI → MongoDB $vectorSearch)
2. Системный промпт = `auto-diagnostics-v2.skill` + данные авто + DTC + симптомы + найденные атомы
3. Инструкция в промпте: "НЕ переспрашивай про DTC и симптомы — они уже переданы"
4. OpenRouter → Gemini 2.5 Pro → ответ по логике скилла
5. Китайские марки: маркер `[TIER: premium-cn]` вырезается из ответа
6. Если передан `session_id` → ход диалога пишется в `sessions.rag_trace` (какие атомы нашли, с каким score)

### Логика `/api/solve` (v2):
1. Парсит `[CASE_SUMMARY]{json}[/CASE_SUMMARY]` из последних сообщений бота
2. Сохраняет кейс в `cases_pending` с полем `case_summary`
3. Закрывает сессию в `sessions` (status: solved)
4. Запускает `_auto_atomize()`: кейс → Gemini Flash Lite → черновик атома в `atoms_draft`

### Логика авто-атомизации (`_auto_atomize`):
1. Gemini Flash Lite формирует структурированный атом из кейса (title, content, root_cause, diagnostic_steps, false_hypotheses, ref_values)
2. Валидация: content ≥ 80 символов, есть root_cause или diagnostic_steps
3. Черновик пишется в `atoms_draft` со статусом `pending_review`
4. Менеджер видит готовый атом → одна кнопка «Одобрить»
5. Approve: генерируется Voyage AI эмбеддинг → атом вставляется в `atoms` (status: active)

### Модель данных кейса (cases_pending):
```json
{
  "case_id": "case_xxxxxxxx",
  "vehicle": { "brand": "", "model": "", "year": "", "engine": "" },
  "messages": [...],
  "service_id": "",
  "service_name": "",
  "dtc_codes": ["P0420"],
  "symptoms": ["Check Engine", "Расход вырос"],
  "symptom_text": "",
  "root_cause": "Отравленный катализатор",
  "ai_rating": 5,
  "tools_used": ["Сканер OBD2", "Мультиметр"],
  "ref_value": "Лямбда после катализатора копирует сигнал до",
  "no_answer": false,
  "client": { "name": "", "phone": "", "car": "", "labor_hours": "", "note": "" },
  "status": "pending",
  "created_at": ""
}
```

---

## Биллинг и тарифы

**1 кредит = 1 диагностическая сессия**

| Тариф | Цена | Условие |
|-------|------|---------|
| Стандарт | 1 000 ₽ | Все кроме китайских |
| Стандарт + Китай | 1 500 ₽ | Все марки |
| Бета | 600 ₽ | Первые 100 сервисов, все марки |
| Топ-3 пожизненно | 300 ₽ | По итогу беты (30 000 атомов) |

**Программа лояльности:**
- Топ-10 ежемесячно → +10 бесплатных кредитов
- Топ-3 по итогу беты → 300 ₽/запрос пожизненно
- Конец беты = 30 000 идеальных атомов (сейчас **3 179**)

**Представители:** 10% комиссия от каждого пополнения кредитов.

---

## База данных (MongoDB Atlas)

**Кластер:** `diagnostik.mnyilci.mongodb.net`  
**БД:** `autodiag`  
**Коллекции:**
- `atoms` — **3 179 атомов** знаний с векторными эмбеддингами (индекс "Diagnostik"). Мастер-коллекция (v2).
- `atoms_draft` — черновики атомов из кейсов сервисов, ждут ревью менеджером (авто-атомизация)
- `cases_pending` — кейсы от механиков (содержат `case_summary` из маркера скилла v2)
- `sessions` — каждая диагностическая сессия с первого сообщения + `rag_trace[]`
- `services` — автосервисы с кредитами
- `representatives` — представители с комиссией
- `transactions` — история пополнений

---

## Секреты (`.env` файлы — НЕ в git)

```
MONGODB_URI=mongodb+srv://...@diagnostik.mnyilci.mongodb.net/
DATABASE_NAME=autodiag
VOYAGE_API_KEY=pa-...
OPENROUTER_API_KEY=sk-or-v1-...
ADMIN_KEY=autodiag_admin_2026
```

Хранятся в: `c:\dia\.env` (мастер) и `c:\dia\CarCar\.env` (для локального запуска).

---

## Запуск локально

```powershell
# Убить старые процессы если нужно:
$p = (netstat -ano | Select-String ":8000 " | Select-String "LISTENING" | % { ($_ -split "\s+")[-1] } | Select-Object -First 1); if ($p) { Stop-Process -Id $p -Force }

# Бэкенд (FastAPI):
cd c:\dia\CarCar
python -m uvicorn api.index:app --host 0.0.0.0 --port 8000

# Фронтенд (Vite):
cd c:\dia\CarCar
npx vite --port 5173
```

Открыть: `http://localhost:5173`  
Админка: `http://localhost:5173?admin=1&key=autodiag_admin_2026`  
API-проверка: `http://localhost:8000/api/health`

---

## Скрипты в `C:\dia\`

| Файл | Назначение |
|------|-----------|
| `autodata_parser.py` | Парсинг Autodata.ru |
| `process_mwf_images.py` | Анализ осциллограмм через Vision LLM |
| `enrich_atoms.py` | Обогащение пустых reference-атомов через LLM |
| `import_mongo.py` | Импорт атомов в MongoDB Atlas |
| `pipeline.py` | Ядро обработки данных |
| `output/atoms_clean.jsonl` | **Единственный источник истины базы данных** (3 199 строк) |
| `output/atoms_chinese_v1.jsonl` | Китайские атомы v1 (6 кейсов: Haval H6 x5, Geely Emgrand x1) |
| `auto-diagnostics.skill` | Скилл AI-диагноста (ZIP: SKILL.md + references/) |

---

## Деплой (Vercel)

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [{"source": "/api/:path*", "destination": "/api/index"}]
}
```

Переменные окружения: `MONGODB_URI`, `VOYAGE_API_KEY`, `OPENROUTER_API_KEY`, `DATABASE_NAME`, `ADMIN_KEY`.

---

## Китайские марки — статус

### В приложении (vehicleData.ts → `CHINESE_VEHICLE_DATA`):
15 брендов: Geely, Haval, Chery, Changan, BYD, Omoda, Exeed, Jetour, JAC, Москвич, Tank, Lixiang, BAIC, FAW Bestune, Dongfeng, Great Wall.
Переключатель "Обычные / 🇨🇳 Китайские" на экране формы.

### В базе знаний (атомы):
6 кейсов из открытых китайских источников (autohome.com.cn, qcds.com):
- Haval H6 1.5T — P0302 свеча цил.2
- Haval H6 дизель — холодный пуск, стартер
- Haval H6 1.5T — λ-датчик O2, богатая смесь
- Haval H6 дизель — нет тяги, угол опережения −7.7°
- Haval H6 1.5T — болячки DCT трансмиссии
- Geely Emgrand EC7 — P0303, алгоритм диагностики

### Источники мануалов для пополнения:
| Сайт | Что есть | Цена |
|------|----------|------|
| **dongcheyun.com** (东车云) | Полные мануалы + DTC-таблицы по всем КНР-маркам | 360 ¥/год (~4 200 ₽), 3 дня бесплатно |
| **qixiu88.com** (汽修巴巴) | Мануалы + электросхемы | ~200–400 ¥/год (VIP, цена за логином) |
| **club-haval.ru, geely-club.ru** | Русскоязычные кейсы механиков | Бесплатно |

---

## Следующие приоритеты

1. **Пополнение базы китайскими мануалами** — попробовать 3 дня бесплатно на dongcheyun.com, скачать DTC-таблицы Haval H6, Geely Emgrand, Chery Tiggo 4/7, Changan CS35/CS55
2. **Деплой на Vercel** — добавить env vars и задеплоить `CarCar/`
3. **Заказ-наряд PDF** — следующий документ после акта диагностики (юридически обязательный)
4. **Гарантийный талон** — повышает доверие клиента к сервису
5. **Рекомендации по ТО** — список работ через N км, мотивирует повторные визиты
6. **Наполнение базы** — дозапустить `enrich_atoms.py`
7. **Корейские авто** — интеграция `gds4all` для Hyundai/Kia
8. **VAG** — парсинг Ross-Tech Wiki
