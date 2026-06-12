# 2LS — AI-диагностика для автосервисов

Telegram Mini App: диалоговый AI-диагност для механиков на базе RAG + LLM.

## Запуск локально

```bash
# Зависимости (один раз)
npm install
pip install -r requirements.txt

# Бэкенд (FastAPI, порт 8000)
python -m uvicorn api.index:app --host 0.0.0.0 --port 8000

# Фронтенд (Vite, порт 5173)
npx vite --port 5173
```

Открыть: http://localhost:5173  
API: http://localhost:8000/api/health

## Структура

```
CarCar/
├── api/
│   └── index.py          — FastAPI бэкенд (RAG + LLM + MongoDB)
├── src/
│   ├── App.tsx            — Основное приложение (4 экрана)
│   ├── AdminPanel.tsx     — Панель администратора
│   ├── RepDashboard.tsx   — Кабинет представителя
│   ├── data/
│   │   ├── vehicleData.ts — Каскадные дропдауны марка/модель/двигатель
│   │   └── presets.ts     — Список CAR_BRANDS
│   └── main.tsx / index.css
├── .env                   — Секреты (не в git)
├── vercel.json            — Деплой конфиг
└── requirements.txt       — Python зависимости
```

## Переменные окружения (.env)

```
MONGODB_URI=mongodb+srv://...
DATABASE_NAME=autodiag
VOYAGE_API_KEY=pa-...
OPENROUTER_API_KEY=sk-or-v1-...
ADMIN_KEY=autodiag_admin_2026
```

## Деплой на Vercel

1. Добавить env vars в Vercel Dashboard
2. `vercel --prod`

## Панель администратора

`http://localhost:5173?admin=1&key=autodiag_admin_2026`

## Кабинет представителя

`http://localhost:5173?rep_token=<token>`
