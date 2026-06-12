"""
🔧 AutoDiag AI — Telegram-бот для автодиагностов
Поиск неисправностей по базе знаний MongoDB Atlas + Voyage AI
"""

import os
import logging
from telegram import (
    Update, InlineKeyboardButton, InlineKeyboardMarkup, ReplyKeyboardRemove
)
from telegram.ext import (
    Application, CommandHandler, CallbackQueryHandler,
    MessageHandler, ConversationHandler, filters
)
from pymongo import MongoClient
import voyageai

# ─── Настройки ────────────────────────────────────────────────────
BOT_TOKEN = "8945508292:AAHbe27iT20NdNZF-ypE_jfgzG7YC1CdXXs"
MONGODB_URI = "mongodb+srv://phukha468_db_user:UXHT3F7741jbcSdA@diagnostik.mnyilci.mongodb.net/?appName=diagnostik"
VOYAGE_API_KEY = "pa-zeo2aa5B5YdWDCtkPmuEVhuV9BF621NUoz-XC97HmJ1"
DB_NAME = "autodiag"
COLLECTION = "atoms"
VECTOR_INDEX = "Diagnostik"

# URL задеплоенного Mini App (заменить после деплоя на Railway/Vercel)
MINI_APP_URL = "https://autodiag-app.railway.app"

# ─── Этапы диалога ────────────────────────────────────────────────
SELECT_BRAND, SELECT_MODEL, ENTER_PROBLEM = range(3)

# ─── Марки и модели (расширяемый справочник) ──────────────────────
BRANDS = {
    "🇰🇷 Hyundai": {
        "callback": "brand_hyundai",
        "make": "Hyundai",
        "models": ["Solaris", "Creta", "Tucson", "Santa Fe", "Elantra", "i30", "ix35", "Accent", "Sonata", "Porter"]
    },
    "🇰🇷 Kia": {
        "callback": "brand_kia",
        "make": "Kia",
        "models": ["Rio", "Ceed", "Sportage", "Sorento", "Cerato", "Optima", "Soul", "Seltos", "K5", "Carnival"]
    },
    "🇩🇪 Volkswagen": {
        "callback": "brand_vw",
        "make": "Volkswagen",
        "models": ["Polo", "Golf", "Tiguan", "Passat", "Jetta", "Touareg", "Tiguan", "Caddy", "Transporter", "Amarok"]
    },
    "🇩🇪 Skoda": {
        "callback": "brand_skoda",
        "make": "Skoda",
        "models": ["Octavia", "Rapid", "Kodiaq", "Karoq", "Superb", "Fabia", "Yeti", "Roomster"]
    },
    "🇩🇪 Audi": {
        "callback": "brand_audi",
        "make": "Audi",
        "models": ["A3", "A4", "A5", "A6", "A7", "A8", "Q3", "Q5", "Q7", "TT"]
    },
    "🇩🇪 SEAT / Cupra": {
        "callback": "brand_seat",
        "make": "SEAT",
        "models": ["Leon", "Ibiza", "Ateca", "Arona", "Tarraco", "Cupra Formentor"]
    },
    "🇨🇳 Chery": {
        "callback": "brand_chery",
        "make": "Chery",
        "models": ["Tiggo 4", "Tiggo 7 Pro", "Tiggo 8 Pro", "Arrizo", "Omoda C5"]
    },
    "🇨🇳 Haval": {
        "callback": "brand_haval",
        "make": "Haval",
        "models": ["Jolion", "F7", "F7x", "H5", "H9", "Dargo"]
    },
    "🇨🇳 Geely": {
        "callback": "brand_geely",
        "make": "Geely",
        "models": ["Coolray", "Atlas", "Atlas Pro", "Monjaro", "Tugella", "Emgrand"]
    },
    "🇨🇳 Changan": {
        "callback": "brand_changan",
        "make": "Changan",
        "models": ["CS35 Plus", "CS55 Plus", "CS75 Plus", "UNI-K", "UNI-T", "UNI-V"]
    },
    "🔍 Любая марка": {
        "callback": "brand_any",
        "make": None,
        "models": []
    },
}

# ─── Логирование ──────────────────────────────────────────────────
logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# ─── Подключения ──────────────────────────────────────────────────
mongo_client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
db = mongo_client[DB_NAME]
collection = db[COLLECTION]
voyage_client = voyageai.Client(api_key=VOYAGE_API_KEY)


# ══════════════════════════════════════════════════════════════════
#  Функция поиска по базе
# ══════════════════════════════════════════════════════════════════
def search_atoms(query_text: str, make: str = None, model: str = None, limit: int = 5):
    """
    Векторный поиск в MongoDB Atlas через Voyage AI.
    Возвращает список наиболее релевантных атомов.
    """
    try:
        # 1. Создаём embedding запроса
        result = voyage_client.embed([query_text], model="voyage-3", input_type="query")
        query_vector = result.embeddings[0]

        # 2. Строим pipeline для Atlas Vector Search
        vector_search_stage = {
            "$vectorSearch": {
                "index": VECTOR_INDEX,
                "path": "embedding",
                "queryVector": query_vector,
                "numCandidates": 100,
                "limit": limit * 2,  # берём больше, чтобы потом отфильтровать
            }
        }

        # Фильтр по марке/модели (если указаны)
        # MongoDB vectorSearch поддерживает filter внутри $vectorSearch
        if make:
            vector_search_stage["$vectorSearch"]["filter"] = {}
            vector_search_stage["$vectorSearch"]["filter"]["vehicle.make"] = {
                "$regex": make, "$options": "i"
            }

        pipeline = [
            vector_search_stage,
            {
                "$project": {
                    "title": 1,
                    "content": 1,
                    "symptoms": 1,
                    "dtc_codes": 1,
                    "vehicle": 1,
                    "tools_required": 1,
                    "parts": 1,
                    "source": 1,
                    "score": {"$meta": "vectorSearchScore"},
                    "_id": 0
                }
            },
            {"$limit": limit}
        ]

        results = list(collection.aggregate(pipeline))
        
        # Если фильтр по марке не дал результатов, ищем без фильтра
        if not results and make:
            del vector_search_stage["$vectorSearch"]["filter"]
            results = list(collection.aggregate(pipeline))
            
        return results

    except Exception as e:
        logger.error(f"Search error: {e}")
        return []


# ══════════════════════════════════════════════════════════════════
#  Форматирование ответа
# ══════════════════════════════════════════════════════════════════
def format_result(atom: dict, index: int) -> str:
    """Красиво форматирует один атом для Telegram."""
    title = atom.get("title", "Без названия")
    content = atom.get("content", "")
    score = atom.get("score", 0)
    symptoms = atom.get("symptoms", [])
    dtc = atom.get("dtc_codes", [])
    vehicle = atom.get("vehicle", {})
    tools = atom.get("tools_required", [])
    parts = atom.get("parts", [])
    source = atom.get("source", "")

    # Ограничиваем длину контента
    if len(content) > 1500:
        content = content[:1500] + "..."

    # Формируем сообщение
    lines = []
    lines.append(f"{'─' * 30}")
    lines.append(f"🔧 *Результат #{index + 1}* (совпадение: {score:.0%})")
    lines.append(f"📋 *{title}*")
    lines.append("")

    if isinstance(vehicle, dict):
        v_parts = []
        if vehicle.get("make"): v_parts.append(vehicle["make"])
        if vehicle.get("model"): v_parts.append(vehicle["model"])
        if vehicle.get("year"): v_parts.append(str(vehicle["year"]))
        if vehicle.get("engine"): v_parts.append(vehicle["engine"])
        if v_parts:
            lines.append(f"🚗 *Автомобиль:* {' '.join(v_parts)}")

    if dtc:
        lines.append(f"⚠️ *Коды ошибок:* {', '.join(dtc[:5])}")

    if symptoms:
        lines.append(f"🔍 *Симптомы:* {', '.join(symptoms[:5])}")

    lines.append("")
    lines.append(f"📝 *Описание:*")
    lines.append(content)

    if tools:
        tools_str = ", ".join(tools[:5]) if isinstance(tools, list) else str(tools)
        lines.append(f"\n🛠 *Инструменты:* {tools_str}")

    if parts:
        parts_str = ", ".join(parts[:5]) if isinstance(parts, list) else str(parts)
        lines.append(f"📦 *Запчасти:* {parts_str}")

    if source:
        lines.append(f"\n📚 _Источник: {source}_")

    return "\n".join(lines)


# ══════════════════════════════════════════════════════════════════
#  Обработчики Telegram
# ══════════════════════════════════════════════════════════════════

async def start(update: Update, context) -> int:
    """Приветствие + кнопка Mini App."""
    try:
        atom_count = collection.count_documents({"embedding": {"$exists": True}})
    except:
        atom_count = "???"

    welcome = (
        "🔧 *AutoDiag AI* — Интеллектуальный диагност для СТО\n\n"
        f"📊 База знаний: *{atom_count} атомов* (кейсы, DTC, осциллограммы)\n"
        "🧠 Гибридный поиск: Voyage AI + MongoDB Atlas\n\n"
        "Нажмите кнопку ниже чтобы открыть диагностику:"
    )

    # Основная кнопка — открыть Mini App
    webapp_button = InlineKeyboardButton(
        "🚗 Открыть AutoDiag",
        web_app={"url": MINI_APP_URL}
    )
    # Fallback — текстовый поиск для тех, у кого нет поддержки WebApp
    text_button = InlineKeyboardButton("🔍 Текстовый поиск", callback_data="text_search")

    buttons = [[webapp_button], [text_button]]

    await update.message.reply_text(
        welcome,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(buttons)
    )
    return SELECT_BRAND


async def brand_selected(update: Update, context) -> int:
    """Обработка выбора марки."""
    query = update.callback_query
    await query.answer()

    callback = query.data

    # Ищем выбранную марку
    selected_brand = None
    for name, info in BRANDS.items():
        if info["callback"] == callback:
            selected_brand = name
            context.user_data["make"] = info["make"]
            context.user_data["brand_name"] = name
            break

    if not selected_brand:
        return SELECT_BRAND

    make = context.user_data.get("make")
    models = BRANDS[selected_brand]["models"]

    if make is None or not models:
        # "Любая марка" — сразу к описанию проблемы
        context.user_data["model"] = None
        await query.edit_message_text(
            "🔍 *Поиск по всей базе*\n\n"
            "Опишите проблему автомобиля.\n"
            "Чем подробнее — тем точнее результат!\n\n"
            "💡 *Примеры:*\n"
            "• _Троит на холодную, ошибка P0340_\n"
            "• _Стук при повороте руля на Hyundai Solaris_\n"
            "• _Плавают обороты после замены свечей_\n"
            "• _P0171 бедная смесь Volkswagen 1.4 TSI_",
            parse_mode="Markdown"
        )
        return ENTER_PROBLEM

    # Показываем модели
    buttons = []
    for i in range(0, len(models), 3):
        row = []
        for j in range(i, min(i + 3, len(models))):
            row.append(InlineKeyboardButton(
                models[j],
                callback_data=f"model_{models[j]}"
            ))
        buttons.append(row)
    buttons.append([InlineKeyboardButton("🔍 Любая модель", callback_data="model_any")])

    await query.edit_message_text(
        f"🚗 Марка: *{selected_brand}*\n\n"
        "Выберите *модель*:",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(buttons)
    )
    return SELECT_MODEL


async def model_selected(update: Update, context) -> int:
    """Обработка выбора модели."""
    query = update.callback_query
    await query.answer()

    model_data = query.data.replace("model_", "")
    if model_data == "any":
        context.user_data["model"] = None
        model_display = "любая"
    else:
        context.user_data["model"] = model_data
        model_display = model_data

    brand_name = context.user_data.get("brand_name", "")
    make = context.user_data.get("make", "")

    await query.edit_message_text(
        f"🚗 *{brand_name}* {model_display}\n\n"
        "Теперь опишите *проблему / неисправность*.\n"
        "Можно указать код ошибки, симптомы, условия:\n\n"
        "💡 *Примеры:*\n"
        f"• _Ошибка P0340, долго крутит стартер_\n"
        f"• _Вибрация на холостых, пропуски зажигания_\n"
        f"• _Загорелся CHECK, дымит на прогреве_\n"
        f"• _Стук в передней подвеске при езде по неровностям_",
        parse_mode="Markdown"
    )
    return ENTER_PROBLEM


async def process_problem(update: Update, context) -> int:
    """Поиск решения в базе знаний."""
    problem_text = update.message.text
    make = context.user_data.get("make")
    model = context.user_data.get("model")
    brand_name = context.user_data.get("brand_name", "Любая марка")

    # Формируем строку поиска с контекстом
    search_query = problem_text
    if make:
        search_query = f"{make} {model or ''} {problem_text}"

    vehicle_info = brand_name
    if model:
        vehicle_info += f" {model}"

    await update.message.reply_text(
        f"🔍 *Ищу решение...*\n"
        f"🚗 {vehicle_info}\n"
        f"💬 _{problem_text}_\n\n"
        f"⏳ Анализирую базу знаний...",
        parse_mode="Markdown"
    )

    # Поиск в MongoDB
    results = search_atoms(search_query, make=make, model=model, limit=3)

    if not results:
        await update.message.reply_text(
            "😔 К сожалению, по вашему запросу ничего не найдено.\n\n"
            "💡 *Попробуйте:*\n"
            "• Использовать другие ключевые слова\n"
            "• Указать код ошибки (DTC)\n"
            "• Выбрать «Любая марка» для расширенного поиска\n\n"
            "Нажмите /start чтобы начать заново.",
            parse_mode="Markdown"
        )
        return ConversationHandler.END

    # Отправляем результаты
    header = (
        f"✅ *Найдено {len(results)} результат(ов)!*\n"
        f"🚗 {vehicle_info} | 💬 _{problem_text}_\n"
    )
    await update.message.reply_text(header, parse_mode="Markdown")

    for i, atom in enumerate(results):
        formatted = format_result(atom, i)
        # Telegram лимит 4096 символов
        if len(formatted) > 4000:
            formatted = formatted[:4000] + "\n\n_...текст обрезан_"
        try:
            await update.message.reply_text(formatted, parse_mode="Markdown")
        except Exception:
            # Если Markdown сломался, отправляем без форматирования
            await update.message.reply_text(formatted)

    # Кнопки для продолжения
    buttons = [
        [InlineKeyboardButton("🔄 Новый поиск", callback_data="restart")],
        [InlineKeyboardButton("🔍 Уточнить запрос (та же машина)", callback_data="refine")],
    ]
    await update.message.reply_text(
        "👆 Выберите действие:",
        reply_markup=InlineKeyboardMarkup(buttons)
    )
    return ConversationHandler.END


async def restart_callback(update: Update, context) -> int:
    """Перезапуск диалога через callback."""
    query = update.callback_query
    await query.answer()

    if query.data == "refine":
        await query.edit_message_text(
            "✏️ Введите *уточнённый запрос*\n"
            "(марка/модель сохранены):",
            parse_mode="Markdown"
        )
        return ENTER_PROBLEM

    # restart
    context.user_data.clear()

    try:
        atom_count = collection.count_documents({"embedding": {"$exists": True}})
    except:
        atom_count = "???"

    buttons = []
    brand_names = list(BRANDS.keys())
    for i in range(0, len(brand_names), 2):
        row = []
        for j in range(i, min(i + 2, len(brand_names))):
            name = brand_names[j]
            callback = BRANDS[name]["callback"]
            row.append(InlineKeyboardButton(name, callback_data=callback))
        buttons.append(row)

    await query.edit_message_text(
        f"🔧 *AutoDiag AI* — Новый поиск\n\n"
        f"📊 В базе: *{atom_count} кейсов*\n\n"
        "Выберите *марку автомобиля*:",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(buttons)
    )
    return SELECT_BRAND


async def cancel(update: Update, context) -> int:
    """Отмена диалога."""
    await update.message.reply_text(
        "❌ Поиск отменён. Нажмите /start чтобы начать заново.",
        reply_markup=ReplyKeyboardRemove()
    )
    return ConversationHandler.END


# ══════════════════════════════════════════════════════════════════
#  Запуск бота
# ══════════════════════════════════════════════════════════════════
def main():
    """Запуск бота."""
    print("🚀 Запускаю AutoDiag AI бота...")

    # Проверяем подключение к MongoDB
    try:
        mongo_client.admin.command('ping')
        count = collection.count_documents({"embedding": {"$exists": True}})
        print(f"✅ MongoDB Atlas: подключено ({count} атомов с эмбеддингами)")
    except Exception as e:
        print(f"❌ MongoDB: {e}")
        return

    app = Application.builder().token(BOT_TOKEN).build()

    # ConversationHandler для пошагового ввода
    conv_handler = ConversationHandler(
        entry_points=[CommandHandler("start", start)],
        states={
            SELECT_BRAND: [
                CallbackQueryHandler(brand_selected, pattern="^brand_"),
            ],
            SELECT_MODEL: [
                CallbackQueryHandler(model_selected, pattern="^model_"),
            ],
            ENTER_PROBLEM: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, process_problem),
            ],
        },
        fallbacks=[
            CommandHandler("cancel", cancel),
            CommandHandler("start", start),
            CallbackQueryHandler(restart_callback, pattern="^(restart|refine)$"),
        ],
    )

    app.add_handler(conv_handler)
    # Обработчик для кнопок restart/refine вне контекста диалога
    app.add_handler(CallbackQueryHandler(restart_callback, pattern="^(restart|refine)$"))

    print("🤖 Бот запущен! Ожидаю сообщения...")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
