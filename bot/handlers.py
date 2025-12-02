"""
Telegram Bot handlers
"""
import re
from typing import Optional

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import ContextTypes
from telegram.constants import ParseMode
from telegram.error import BadRequest

from database import db
from api_service import api_service
from user_context_service import user_context_service
from config import WEBAPP_URL


def normalize_group_code(raw_value: str) -> Optional[str]:
    """Привести введення користувача до формату черги ГПВ (наприклад 4.1 -> 41)"""
    if not raw_value:
        return None
    cleaned = raw_value.strip().lower()
    cleaned = cleaned.replace(",", ".")
    cleaned = re.sub(r"(група|group)", "", cleaned)
    digits_only = re.sub(r"\D", "", cleaned)
    if 1 <= len(digits_only) <= 4:
        return digits_only
    return None


def build_location_block(context: dict, formatted_group: str) -> str:
    """Згенерувати текст про адресу/групу для повідомлень"""
    if not context or context.get("context_type") != "address":
        label = context.get("label") if context else None
        label_text = label or f"Група {formatted_group}"
        return (
            f"📍 <b>Ваш опис:</b>\n"
            f"   {label_text}\n\n"
            f"🔌 <b>Обрана група ГПВ:</b> {formatted_group}\n\n"
        )
    return (
        f"📍 <b>Ваша адреса:</b>\n"
        f"   {context['city_name']}, {context['street_name']}, {context['building_name']}\n\n"
        f"🔌 <b>Ваша група ГПВ:</b> {formatted_group}\n\n"
    )


async def safe_edit_message(query, *args, **kwargs):
    """Обернути edit_message_text щоб ігнорувати помилку про незмінене повідомлення"""
    try:
        await query.edit_message_text(*args, **kwargs)
    except BadRequest as exc:
        if "message is not modified" in str(exc).lower():
            return
        raise


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handler для команди /start"""
    user = update.effective_user
    
    print(f"[START] User {user.id} ({user.username}) started bot")
    
    # Зберегти користувача в БД
    await db.add_user(
        user_id=user.id,
        username=user.username,
        first_name=user.first_name,
        last_name=user.last_name
    )
    
    # Перевірити чи є збережений контекст (адреса або група)
    schedule_context = await user_context_service.get_context(user.id)
    
    print(f"[START] User {user.id} schedule context: {schedule_context}")
    
    welcome_text = (
        f"👋 Вітаю, {user.first_name}!\n\n"
        f"🔌 Я бот для відстеження графіків відключень електроенергії у Львівській області.\n\n"
    )
    
    if schedule_context:
        cherg_gpv = schedule_context.get("cherg_gpv", "")
        formatted_group = await api_service.get_schedule_group(cherg_gpv)
        
        if schedule_context.get("context_type") == "address":
            welcome_text += (
                f"📍 <b>Ваша адреса:</b>\n"
                f"   {schedule_context['city_name']}, {schedule_context['street_name']}, {schedule_context['building_name']}\n"
                f"⚡ <b>Група ГПВ:</b> {formatted_group}\n\n"
            )
        else:
            label = schedule_context.get("label") or f"Група {formatted_group}"
            welcome_text += (
                f"📍 <b>Ваш опис:</b>\n"
                f"   {label}\n"
                f"⚡ <b>Група ГПВ:</b> {formatted_group}\n\n"
            )
    else:
        welcome_text += (
            f"📍 Ви ще не налаштували свою адресу.\n"
            f"Натисніть кнопку нижче щоб обрати своє місто, вулицю та будинок\n"
            f"або надішліть команду <code>/schedule 4.1</code> щоб швидко задати групу.\n\n"
        )
    
    welcome_text += "Оберіть дію:"
    
    keyboard = get_main_keyboard(schedule_context is not None)
    
    await update.message.reply_text(
        welcome_text,
        reply_markup=keyboard,
        parse_mode=ParseMode.HTML
    )


def get_main_keyboard(has_schedule: bool = False) -> InlineKeyboardMarkup:
    """Отримати головну клавіатуру"""
    import time
    buttons = []
    
    # Кнопка для відкриття Web App з timestamp для обходу кешу
    webapp_url = f"{WEBAPP_URL}?v={int(time.time())}"
    buttons.append([
        InlineKeyboardButton(
            "📍 Налаштувати адресу",
            web_app=WebAppInfo(url=webapp_url)
        )
    ])
    
    if has_schedule:
        buttons.append([
            InlineKeyboardButton("⚡ Показати графік", callback_data="show_schedule")
        ])
        buttons.append([
            InlineKeyboardButton("🔔 Сповіщення", callback_data="notifications"),
            InlineKeyboardButton("📋 Мої адреси", callback_data="my_addresses")
        ])
    
    buttons.append([
        InlineKeyboardButton("ℹ️ Допомога", callback_data="help"),
        InlineKeyboardButton("📊 Інформація", callback_data="info")
    ])
    
    return InlineKeyboardMarkup(buttons)


async def callback_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handler для callback кнопок"""
    query = update.callback_query
    try:
        await query.answer()
    except BadRequest as exc:
        if "query is too old" in str(exc).lower():
            return
        raise
    
    user_id = query.from_user.id
    data = query.data
    
    if data == "show_schedule":
        await show_schedule(query, user_id)
    
    elif data == "notifications":
        await show_notifications_menu(query, user_id)
    
    elif data == "enable_notifications":
        await toggle_notifications(query, user_id, True)
    
    elif data == "disable_notifications":
        await toggle_notifications(query, user_id, False)
    
    elif data == "my_addresses":
        await show_addresses(query, user_id)
    
    elif data.startswith("delete_address_"):
        address_id = int(data.replace("delete_address_", ""))
        await delete_address(query, user_id, address_id)
    
    elif data == "help":
        await show_help(query)
    
    elif data == "info":
        await show_info(query)
    
    elif data == "back_to_main":
        schedule_context = await user_context_service.get_context(user_id)
        await safe_edit_message(
            query,
            "🏠 Головне меню\n\nОберіть дію:",
            reply_markup=get_main_keyboard(schedule_context is not None),
            parse_mode=ParseMode.HTML
        )


async def show_schedule(query, user_id: int):
    """Показати поточний графік"""
    schedule_context = None
    try:
        schedule_context = await user_context_service.get_context(user_id)
        
        if not schedule_context or not schedule_context.get("cherg_gpv"):
            await safe_edit_message(
                query,
                "❌ Ви ще не налаштували свою адресу.\n"
                "Натисніть кнопку 'Налаштувати адресу' або надішліть команду <code>/schedule 4.1</code>.",
                reply_markup=get_main_keyboard(False),
                parse_mode=ParseMode.HTML
            )
            return
        
        # Отримати поточний графік
        grafics = await api_service.get_current_grafics()
        
        if not grafics or not grafics.get("rawHtml"):
            await safe_edit_message(
                query,
                "⚠️ Наразі немає доступних графіків відключень.",
                reply_markup=get_main_keyboard(True),
                parse_mode=ParseMode.HTML
            )
            return
        
        raw_html = grafics.get("rawHtml", "")
        cherg_gpv = schedule_context.get("cherg_gpv", "")
        formatted_group = await api_service.get_schedule_group(cherg_gpv)
        
        # Парсити персоналізований графік
        parsed_schedule = api_service.parse_schedule_for_group(raw_html, cherg_gpv)
        outages = parsed_schedule.get("outages", [])
        
        # Визначити поточний статус
        from datetime import datetime
        now = datetime.now()
        current_minutes = now.hour * 60 + now.minute
        
        is_power_on = True
        next_change_time = None
        
        for outage in outages:
            start_h, start_m = map(int, outage["start"].split(":"))
            end_h, end_m = map(int, outage["end"].split(":"))
            start_minutes = start_h * 60 + start_m
            end_minutes = end_h * 60 + end_m
            
            if start_minutes <= current_minutes < end_minutes:
                is_power_on = False
                next_change_time = outage["end"]
                break
        
        if is_power_on:
            for outage in outages:
                start_h, start_m = map(int, outage["start"].split(":"))
                start_minutes = start_h * 60 + start_m
                if start_minutes > current_minutes:
                    next_change_time = outage["start"]
                    break
        
        # Форматувати текст відключень
        if outages:
            outage_text = ""
            for outage in outages:
                outage_text += f"   🔴 <b>{outage['start']} - {outage['end']}</b>\n"
        else:
            outage_text = "   🟢 <b>Відключень не заплановано</b>\n"
        
        # Статус зараз
        if is_power_on:
            status_emoji = "🟢"
            status_text = "Зараз світло є"
            if next_change_time:
                status_text += f" (відключення о {next_change_time})"
        else:
            status_emoji = "🔴"
            status_text = "Зараз світла немає"
            if next_change_time:
                status_text += f" (увімкнення о {next_change_time})"
        
        sync_time = await api_service.get_sync_time()
        sync_info = f"\n🕐 Оновлено: {sync_time}" if sync_time else ""
        
        message = (
            f"⚡ <b>Графік погодинних відключень</b>\n\n"
            f"{build_location_block(schedule_context, formatted_group)}"
            f"{status_emoji} <b>{status_text}</b>\n\n"
            f"⏰ <b>Графік на сьогодні:</b>\n"
            f"{outage_text}"
            f"{sync_info}"
        )
        
        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("🔄 Оновити", callback_data="show_schedule")],
            [InlineKeyboardButton("🔙 Назад", callback_data="back_to_main")]
        ])
        
        await safe_edit_message(
            query,
            message,
            reply_markup=keyboard,
            parse_mode=ParseMode.HTML
        )
        
    except Exception as e:
        print(f"Error showing schedule: {e}")
        import traceback
        traceback.print_exc()
        await safe_edit_message(
            query,
            "❌ Помилка при отриманні графіку. Спробуйте пізніше.",
            reply_markup=get_main_keyboard(schedule_context is not None),
            parse_mode=ParseMode.HTML
        )


async def show_notifications_menu(query, user_id: int):
    """Показати меню налаштувань сповіщень"""
    user = await db.get_user(user_id)
    notifications_enabled = user.get("notifications_enabled", False) if user else False
    
    status = "✅ Увімкнено" if notifications_enabled else "❌ Вимкнено"
    
    text = (
        f"🔔 <b>Налаштування сповіщень</b>\n\n"
        f"Статус: {status}\n\n"
        f"Коли увімкнено, ви будете отримувати сповіщення про:\n"
        f"• Оновлення графіку відключень\n"
        f"• Зміни у вашій групі ГПВ"
    )
    
    if notifications_enabled:
        buttons = [
            [InlineKeyboardButton("❌ Вимкнути сповіщення", callback_data="disable_notifications")],
            [InlineKeyboardButton("🔙 Назад", callback_data="back_to_main")]
        ]
    else:
        buttons = [
            [InlineKeyboardButton("✅ Увімкнути сповіщення", callback_data="enable_notifications")],
            [InlineKeyboardButton("🔙 Назад", callback_data="back_to_main")]
        ]
    
    await safe_edit_message(
        query,
        text,
        reply_markup=InlineKeyboardMarkup(buttons),
        parse_mode=ParseMode.HTML
    )


async def toggle_notifications(query, user_id: int, enabled: bool):
    """Увімкнути/вимкнути сповіщення"""
    success = await db.set_notifications(user_id, enabled)
    
    if success:
        status = "увімкнено ✅" if enabled else "вимкнено ❌"
        await query.answer(f"Сповіщення {status}")
    else:
        await query.answer("Помилка при зміні налаштувань")
    
    await show_notifications_menu(query, user_id)


async def show_addresses(query, user_id: int):
    """Показати список адрес користувача"""
    addresses = await db.get_all_user_addresses(user_id)
    
    if not addresses:
        await safe_edit_message(
            query,
            "📋 У вас немає збережених адрес.\n\n"
            "Натисніть 'Налаштувати адресу' щоб додати.",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🔙 Назад", callback_data="back_to_main")]
            ]),
            parse_mode=ParseMode.HTML
        )
        return
    
    text = "📋 <b>Ваші збережені адреси:</b>\n\n"
    buttons = []
    
    for i, addr in enumerate(addresses, 1):
        primary = " ⭐" if addr["is_primary"] else ""
        cherg_gpv = addr.get("cherg_gpv", "")
        formatted_group = await api_service.get_schedule_group(cherg_gpv)
        
        text += (
            f"{i}. {addr['city_name']}, {addr['street_name']}, {addr['building_name']}{primary}\n"
            f"   Група ГПВ: {formatted_group}\n\n"
        )
        
        buttons.append([
            InlineKeyboardButton(f"🗑 Видалити адресу {i}", callback_data=f"delete_address_{addr['id']}")
        ])
    
    buttons.append([InlineKeyboardButton("🔙 Назад", callback_data="back_to_main")])
    
    await safe_edit_message(
        query,
        text,
        reply_markup=InlineKeyboardMarkup(buttons),
        parse_mode=ParseMode.HTML
    )


async def delete_address(query, user_id: int, address_id: int):
    """Видалити адресу"""
    success = await db.delete_user_address(address_id, user_id)
    
    if success:
        await query.answer("Адресу видалено")
    else:
        await query.answer("Помилка при видаленні")
    
    await show_addresses(query, user_id)


async def show_help(query):
    """Показати допомогу"""
    text = (
        "ℹ️ <b>Допомога</b>\n\n"
        "<b>Як користуватись ботом:</b>\n\n"
        "1️⃣ <b>Налаштувати адресу</b>\n"
        "   Натисніть кнопку і оберіть своє місто, вулицю та номер будинку.\n"
        "   Або надішліть <code>/schedule 4.1</code> щоб одразу вказати групу.\n\n"
        "2️⃣ <b>Показати графік</b>\n"
        "   Перегляньте актуальний графік відключень для вашої групи.\n\n"
        "3️⃣ <b>Сповіщення</b>\n"
        "   Увімкніть сповіщення, щоб отримувати оновлення про зміни графіку.\n\n"
        "<b>Команди:</b>\n"
        "/start - Головне меню\n"
        "/schedule - Показати графік (можна <code>/schedule 4.1</code>)\n"
        "/notifications - Налаштування сповіщень\n"
        "/help - Ця довідка"
    )
    
    await safe_edit_message(
        query,
        text,
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("🔙 Назад", callback_data="back_to_main")]
        ]),
        parse_mode=ParseMode.HTML
    )


async def show_info(query):
    """Показати інформацію про бота"""
    sync_time = await api_service.get_sync_time()
    sync_info = f"🕐 Останнє оновлення даних: {sync_time}" if sync_time else ""
    
    text = (
        "📊 <b>Інформація</b>\n\n"
        "Цей бот показує графіки погодинних відключень електроенергії "
        "у Львівській області на основі даних з офіційного сайту Львівобленерго.\n\n"
        f"{sync_info}\n\n"
        "🌐 Джерело даних: <a href='https://poweron.loe.lviv.ua'>poweron.loe.lviv.ua</a>\n\n"
        "📧 Зв'язок: @your_username"
    )
    
    await safe_edit_message(
        query,
        text,
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("🔙 Назад", callback_data="back_to_main")]
        ]),
        parse_mode=ParseMode.HTML,
        disable_web_page_preview=True
    )


async def schedule_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handler для команди /schedule"""
    from notifications import notification_service
    user_id = update.effective_user.id
    args = context.args if context.args else []
    if args:
        group_code = normalize_group_code(args[0])
        if not group_code:
            await update.message.reply_text(
                "❌ Неправильний формат групи. Приклад: <code>/schedule 4.1</code>",
                parse_mode=ParseMode.HTML
            )
            return
        label = " ".join(args[1:]).strip() if len(args) > 1 else None
        save_result = await db.set_manual_group(user_id, group_code, label)
        if not save_result:
            await update.message.reply_text(
                "❌ Не вдалося зберегти групу. Спробуйте ще раз.",
                parse_mode=ParseMode.HTML
            )
            return
        formatted_manual_group = await api_service.get_schedule_group(group_code)
        await update.message.reply_text(
            f"✅ Групу {formatted_manual_group} збережено. Формую ваш графік...",
            parse_mode=ParseMode.HTML
        )
    
    if notification_service:
        success = await notification_service.send_schedule_to_user(user_id)
        if not success and not args:
            schedule_context = await user_context_service.get_context(user_id)
            if not schedule_context or not schedule_context.get("cherg_gpv"):
                await update.message.reply_text(
                    "❌ Спершу налаштуйте адресу у веб-формі або надішліть <code>/schedule 4.1</code>.",
                    parse_mode=ParseMode.HTML
                )
    else:
        await update.message.reply_text(
            "⚠️ Сервіс ще запускається. Спробуйте надіслати /schedule знову за хвилину.",
            parse_mode=ParseMode.HTML
        )


async def notifications_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handler для команди /notifications"""
    user_id = update.effective_user.id
    user = await db.get_user(user_id)
    notifications_enabled = user.get("notifications_enabled", False) if user else False
    
    status = "✅ Увімкнено" if notifications_enabled else "❌ Вимкнено"
    
    text = (
        f"🔔 <b>Налаштування сповіщень</b>\n\n"
        f"Статус: {status}"
    )
    
    if notifications_enabled:
        buttons = [[InlineKeyboardButton("❌ Вимкнути", callback_data="disable_notifications")]]
    else:
        buttons = [[InlineKeyboardButton("✅ Увімкнути", callback_data="enable_notifications")]]
    
    await update.message.reply_text(
        text,
        reply_markup=InlineKeyboardMarkup(buttons),
        parse_mode=ParseMode.HTML
    )


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handler для команди /help"""
    text = (
        "ℹ️ <b>Допомога</b>\n\n"
        "<b>Доступні команди:</b>\n\n"
        "/start - Головне меню\n"
        "/schedule - Показати графік (наприклад <code>/schedule 4.1</code>)\n"
        "/notifications - Налаштування сповіщень\n"
        "/help - Ця довідка\n\n"
        "Для налаштування адреси натисніть /start і оберіть 'Налаштувати адресу'."
    )
    
    await update.message.reply_text(text, parse_mode=ParseMode.HTML)


async def webapp_data_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handler для даних з Web App"""
    import json
    
    print(f"[WEBAPP] Received webapp data from user {update.effective_user.id}")
    
    try:
        raw_data = update.effective_message.web_app_data.data
        print(f"[WEBAPP] Raw data: {raw_data}")
        
        data = json.loads(raw_data)
        user_id = update.effective_user.id
        
        print(f"[WEBAPP] Parsed data: {data}")
        
        # Дані приходять в snake_case з WebApp
        city_id = data.get("city_id")
        city_name = data.get("city_name", "")
        street_id = data.get("street_id")
        street_name = data.get("street_name", "")
        building_name = data.get("building_name", "")
        cherg_gpv = data.get("cherg_gpv", "")
        
        print(f"[WEBAPP] Saving address for user {user_id}: {city_name}, {street_name}, {building_name}, group: {cherg_gpv}")
        
        # Зберегти адресу
        success = await db.save_user_address(
            user_id=user_id,
            otg_id=None,
            otg_name="",
            city_id=city_id,
            city_name=city_name,
            street_id=street_id,
            street_name=street_name,
            building_name=building_name,
            cherg_gpv=cherg_gpv
        )
        
        print(f"[WEBAPP] Save result: {success}")
        
        if success:
            formatted_group = await api_service.get_schedule_group(cherg_gpv)
            
            await update.message.reply_text(
                f"✅ Адресу збережено!\n\n"
                f"📍 {city_name}, {street_name}, {building_name}\n"
                f"⚡ Група ГПВ: {formatted_group}\n\n"
                f"Тепер ви можете переглядати графіки відключень.",
                reply_markup=get_main_keyboard(True),
                parse_mode=ParseMode.HTML
            )
        else:
            await update.message.reply_text(
                "❌ Помилка при збереженні адреси. Спробуйте ще раз.",
                reply_markup=get_main_keyboard(False),
                parse_mode=ParseMode.HTML
            )
            
    except Exception as e:
        print(f"[WEBAPP] Error processing webapp data: {e}")
        import traceback
        traceback.print_exc()
        await update.message.reply_text(
            "❌ Помилка при обробці даних. Спробуйте ще раз.",
            parse_mode=ParseMode.HTML
        )
