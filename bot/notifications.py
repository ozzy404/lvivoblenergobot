"""
Notification service for checking and sending schedule updates
"""
import asyncio
import hashlib
from datetime import datetime
from typing import Optional, Dict, List
from telegram import Bot
from telegram.constants import ParseMode
from telegram.error import BadRequest

from api_service import api_service
from database import db
from firebase_service import firebase_service
from user_context_service import user_context_service
from config import CHECK_INTERVAL


class NotificationService:
    """Сервіс для відправки сповіщень про зміни в графіку"""
    
    def __init__(self, bot: Bot):
        self.bot = bot
        self.running = False
        self._tasks = []
        # Кеш: {date: {group_code: outages_hash}}
        self._schedule_cache: Dict[str, Dict[str, str]] = {}

    def _format_location_block(self, context: Dict, formatted_group: str) -> str:
        """Згенерувати блок з описом адреси/групи"""
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
    
    def _get_outages_hash(self, outages: List[Dict]) -> str:
        """Створити хеш для списку відключень"""
        # Сортуємо для стабільності
        sorted_outages = sorted(outages, key=lambda x: x.get('start', ''))
        outages_str = "|".join(f"{o.get('start')}-{o.get('end')}" for o in sorted_outages)
        return hashlib.md5(outages_str.encode()).hexdigest()
    
    async def start(self):
        """Запустити сервіс сповіщень"""
        self.running = True
        # Мінімальне логування
        self._tasks = [
            asyncio.create_task(self._check_for_updates_loop()),
        ]
    
    async def stop(self):
        """Зупинити сервіс сповіщень"""
        self.running = False
        for task in self._tasks:
            task.cancel()
    
    async def _check_for_updates_loop(self):
        """Перевіряти оновлення графіку кожні N хвилин"""
        while self.running:
            try:
                await self._check_and_notify()
                await asyncio.sleep(CHECK_INTERVAL * 60)
            except asyncio.CancelledError:
                break
            except Exception:
                await asyncio.sleep(60)
    
    async def _check_and_notify(self):
        """Перевірити графіки і сповістити тільки про РЕАЛЬНІ зміни"""
        # Отримуємо користувачів з увімкненими сповіщеннями
        users = await firebase_service.get_all_users_with_notifications()
        if not users:
            return
        
        # Отримуємо графіки
        today_data = await api_service.get_current_grafics()
        tomorrow_data = await api_service.get_tomorrow_grafics()
        
        today_date = today_data.get("date", "") if today_data else ""
        today_html = today_data.get("rawHtml", "") if today_data else ""
        
        tomorrow_date = tomorrow_data.get("date", "") if tomorrow_data else ""
        tomorrow_html = tomorrow_data.get("rawHtml", "") if tomorrow_data else ""
        
        for user in users:
            try:
                await self._check_user_schedule(user, today_date, today_html, tomorrow_date, tomorrow_html)
            except Exception:
                pass  # Тихо ігноруємо помилки окремих користувачів
    
    async def _check_user_schedule(self, user: Dict, today_date: str, today_html: str, 
                                    tomorrow_date: str, tomorrow_html: str):
        """Перевірити і сповістити одного користувача про зміни"""
        user_id = user["user_id"]
        cherg_gpv = user.get("cherg_gpv", "")
        if not cherg_gpv:
            return
        
        formatted_group = await api_service.get_schedule_group(cherg_gpv)
        
        # Перевіряємо графік на СЬОГОДНІ
        if today_html and today_date:
            parsed = api_service.parse_schedule_for_group(today_html, cherg_gpv)
            outages = parsed.get("outages", [])
            current_hash = self._get_outages_hash(outages)
            
            # Отримуємо збережений хеш для цієї дати і групи
            saved_hash = await db.get_user_group_hash(user_id, today_date)
            
            if saved_hash is None:
                # Перша поява графіку на цю дату - зберігаємо без сповіщення
                await db.save_user_group_hash(user_id, today_date, current_hash)
            elif saved_hash != current_hash:
                # Графік ЗМІНИВСЯ - сповіщаємо
                await db.save_user_group_hash(user_id, today_date, current_hash)
                await self._send_schedule_update(user, formatted_group, outages, today_date, "сьогодні")
        
        # Перевіряємо графік на ЗАВТРА
        if tomorrow_html and tomorrow_date:
            parsed = api_service.parse_schedule_for_group(tomorrow_html, cherg_gpv)
            outages = parsed.get("outages", [])
            current_hash = self._get_outages_hash(outages)
            
            saved_hash = await db.get_user_group_hash(user_id, tomorrow_date)
            
            if saved_hash is None:
                # Графік на завтра З'ЯВИВСЯ - сповіщаємо
                await db.save_user_group_hash(user_id, tomorrow_date, current_hash)
                await self._send_schedule_update(user, formatted_group, outages, tomorrow_date, "завтра", is_new=True)
            elif saved_hash != current_hash:
                # Графік на завтра ЗМІНИВСЯ - сповіщаємо
                await db.save_user_group_hash(user_id, tomorrow_date, current_hash)
                await self._send_schedule_update(user, formatted_group, outages, tomorrow_date, "завтра")
    
    async def _send_schedule_update(self, user: Dict, formatted_group: str, outages: List[Dict], 
                                     schedule_date: str, period: str, is_new: bool = False):
        """Відправити сповіщення про зміну/появу графіку"""
        user_id = user["user_id"]
        
        # Форматуємо текст
        if outages:
            outage_text = ""
            for outage in outages:
                outage_text += f"   🔴 <b>{outage['start']} - {outage['end']}</b>\n"
        else:
            outage_text = "   🟢 <b>Відключень не заплановано</b>\n"
        
        if is_new:
            header = f"📅 <b>Графік на {period} ({schedule_date}) опубліковано!</b>"
        else:
            header = f"⚠️ <b>Графік на {period} ({schedule_date}) змінився!</b>"
        
        message = (
            f"{header}\n\n"
            f"{self._format_location_block(user, formatted_group)}"
            f"⏰ <b>Графік відключень:</b>\n"
            f"{outage_text}"
        )
        
        # Пробуємо редагувати попереднє повідомлення
        last_msg = await db.get_user_last_message(user_id)
        
        try:
            if last_msg and last_msg.get("schedule_date") == schedule_date:
                # Редагуємо існуюче повідомлення
                await self.bot.edit_message_text(
                    chat_id=user_id,
                    message_id=last_msg["message_id"],
                    text=message,
                    parse_mode=ParseMode.HTML
                )
            else:
                # Надсилаємо нове
                sent = await self.bot.send_message(
                    chat_id=user_id,
                    text=message,
                    parse_mode=ParseMode.HTML
                )
                await db.save_user_last_message(user_id, sent.message_id, schedule_date)
        except BadRequest:
            # Якщо не вдалося редагувати - надсилаємо нове
            try:
                sent = await self.bot.send_message(
                    chat_id=user_id,
                    text=message,
                    parse_mode=ParseMode.HTML
                )
                await db.save_user_last_message(user_id, sent.message_id, schedule_date)
            except Exception:
                pass
        
        await asyncio.sleep(0.3)  # Невелика затримка між повідомленнями
    
    async def send_schedule_to_user(self, user_id: int) -> bool:
        """Відправити поточний графік конкретному користувачу"""
        schedule_context = None
        try:
            schedule_context = await user_context_service.get_context(user_id)
            
            if not schedule_context or not schedule_context.get("cherg_gpv"):
                await self.bot.send_message(
                    chat_id=user_id,
                    text="❌ Ви ще не налаштували адресу або групу.\n"
                         "Натисніть 'Налаштувати адресу' або надішліть <code>/schedule 4.1</code>.",
                    parse_mode=ParseMode.HTML
                )
                return False
            
            grafics = await api_service.get_current_grafics()
            
            if not grafics or not grafics.get("rawHtml"):
                await self.bot.send_message(
                    chat_id=user_id,
                    text="⚠️ Наразі немає доступних графіків відключень.",
                    parse_mode=ParseMode.HTML
                )
                return False
            
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
                status_text = "🟢 <b>Зараз світло є</b>"
                if next_change_time:
                    status_text += f"\n   ⏱ Відключення о {next_change_time}"
            else:
                status_text = "🔴 <b>Зараз світла немає</b>"
                if next_change_time:
                    status_text += f"\n   ⏱ Увімкнення о {next_change_time}"
            
            sync_time = await api_service.get_sync_time()
            sync_info = f"\n🕐 Оновлено: {sync_time}" if sync_time else ""
            
            message = (
                f"⚡ <b>Графік погодинних відключень</b>\n\n"
                f"{self._format_location_block(schedule_context, formatted_group)}"
                f"{status_text}\n\n"
                f"⏰ <b>Графік на сьогодні:</b>\n"
                f"{outage_text}"
                f"{sync_info}"
            )
            
            schedule_date = grafics.get("date", "")
            sent = await self.bot.send_message(
                chat_id=user_id,
                text=message,
                parse_mode=ParseMode.HTML
            )
            
            # Зберігаємо message_id для можливого редагування
            await db.save_user_last_message(user_id, sent.message_id, schedule_date)
            
            return True
            
        except Exception as e:
            return False


# Will be initialized in main.py
notification_service: Optional[NotificationService] = None

