"""
Notification service for checking and sending schedule updates
"""
import asyncio
from datetime import datetime, time
from typing import Optional, Dict, List
from telegram import Bot
from telegram.constants import ParseMode

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
        self.last_image_url: Optional[str] = None
        self._tasks = []

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
    
    async def start(self):
        """Запустити сервіс сповіщень"""
        self.running = True
        print("🔔 Notification service started")
        
        # Отримати останні збережені хеші
        self.last_today_hash = await db.get_last_schedule_hash("today")
        self.last_tomorrow_hash = await db.get_last_schedule_hash("tomorrow")
        
        # Запустити фонову задачу перевірки оновлень
        self._tasks = [
            asyncio.create_task(self._check_for_updates_loop()),
        ]
    
    async def stop(self):
        """Зупинити сервіс сповіщень"""
        self.running = False
        for task in self._tasks:
            task.cancel()
        print("🔕 Notification service stopped")
    
    async def _check_for_updates_loop(self):
        """Перевіряти оновлення графіку кожні N хвилин"""
        while self.running:
            try:
                await self.check_for_updates()
                await asyncio.sleep(CHECK_INTERVAL * 60)
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"Error in update check loop: {e}")
                await asyncio.sleep(60)
    
    async def check_for_updates(self):
        """Перевірити наявність оновлень графіку на сьогодні і завтра"""
        import hashlib
        
        # Перевіряємо графік на СЬОГОДНІ
        try:
            today_grafics = await api_service.get_current_grafics()
            
            if today_grafics and today_grafics.get("rawHtml"):
                raw_html = today_grafics.get("rawHtml", "")
                schedule_date = today_grafics.get("date", "")
                current_hash = hashlib.md5(raw_html.encode()).hexdigest()
                
                if self.last_today_hash and current_hash != self.last_today_hash:
                    print(f"📢 Today's schedule updated!")
                    is_new = await db.save_schedule_hash(schedule_date, current_hash, raw_html)
                    if is_new:
                        await self.send_change_notifications(raw_html, schedule_date, "сьогодні")
                
                self.last_today_hash = current_hash
                
        except Exception as e:
            print(f"Error checking today's schedule: {e}")
        
        # Перевіряємо графік на ЗАВТРА
        try:
            tomorrow_grafics = await api_service.get_tomorrow_grafics()
            
            if tomorrow_grafics and tomorrow_grafics.get("rawHtml"):
                raw_html = tomorrow_grafics.get("rawHtml", "")
                schedule_date = tomorrow_grafics.get("date", "")
                current_hash = hashlib.md5(raw_html.encode()).hexdigest()
                
                if self.last_tomorrow_hash is None:
                    # Перший раз бачимо графік на завтра - повідомляємо
                    print(f"📢 Tomorrow's schedule appeared!")
                    await db.save_schedule_hash(schedule_date, current_hash, raw_html)
                    await self.send_tomorrow_notifications(raw_html, schedule_date)
                elif current_hash != self.last_tomorrow_hash:
                    # Графік на завтра змінився
                    print(f"📢 Tomorrow's schedule updated!")
                    is_new = await db.save_schedule_hash(schedule_date, current_hash, raw_html)
                    if is_new:
                        await self.send_change_notifications(raw_html, schedule_date, "завтра")
                
                self.last_tomorrow_hash = current_hash
            else:
                # Графіку на завтра ще немає
                self.last_tomorrow_hash = None
                
        except Exception as e:
            print(f"Error checking tomorrow's schedule: {e}")
    
    async def send_change_notifications(self, raw_html: str, schedule_date: str, period: str = "сьогодні"):
        """Відправити сповіщення користувачам про зміни в їхній групі"""
        import hashlib
        
        # Беремо користувачів з Firebase
        users = await firebase_service.get_all_users_with_notifications()
        
        if not users:
            print("No users with notifications enabled")
            return
        
        print(f"📢 Checking schedule changes for {len(users)} users...")
        sent_count = 0
        
        for user in users:
            try:
                user_id = user["user_id"]
                cherg_gpv = user.get("cherg_gpv", "")
                formatted_group = await api_service.get_schedule_group(cherg_gpv)
                
                # Парсити персоналізований графік для цієї групи
                parsed_schedule = api_service.parse_schedule_for_group(raw_html, cherg_gpv)
                outages = parsed_schedule.get("outages", [])
                
                # Створюємо хеш для графіка конкретної групи
                group_schedule_str = str(outages)
                group_hash = hashlib.md5(group_schedule_str.encode()).hexdigest()
                
                # Перевіряємо чи змінився графік для цієї групи
                last_group_hash = await db.get_user_group_hash(user_id, schedule_date)
                
                if last_group_hash == group_hash:
                    # Графік для цієї групи не змінився
                    continue
                
                # Зберігаємо новий хеш
                await db.save_user_group_hash(user_id, schedule_date, group_hash)
                
                # Форматувати текст відключень
                if outages:
                    outage_text = ""
                    for outage in outages:
                        outage_text += f"   🔴 <b>{outage['start']} - {outage['end']}</b>\n"
                else:
                    outage_text = "   🟢 <b>Відключень не заплановано</b>\n"
                
                message = (
                    f"⚠️ <b>Графік на {period} змінився!</b>\n\n"
                    f"{self._format_location_block(user, formatted_group)}"
                    f"⏰ <b>Графік відключень:</b>\n"
                    f"{outage_text}"
                )
                
                await self.bot.send_message(
                    chat_id=user_id,
                    text=message,
                    parse_mode=ParseMode.HTML
                )
                
                sent_count += 1
                await asyncio.sleep(0.5)
                
            except Exception as e:
                print(f"Error sending notification to {user.get('user_id')}: {e}")
        
        print(f"📢 Sent {sent_count} change notifications")

    async def send_tomorrow_notifications(self, raw_html: str, schedule_date: str):
        """Відправити сповіщення про новий графік на завтра"""
        # Беремо користувачів з Firebase
        users = await firebase_service.get_all_users_with_notifications()
        
        if not users:
            print("No users with notifications enabled")
            return
        
        print(f"📢 Sending tomorrow's schedule to {len(users)} users...")
        
        for user in users:
            try:
                user_id = user["user_id"]
                cherg_gpv = user.get("cherg_gpv", "")
                formatted_group = await api_service.get_schedule_group(cherg_gpv)
                
                # Парсити персоналізований графік
                parsed_schedule = api_service.parse_schedule_for_group(raw_html, cherg_gpv)
                outages = parsed_schedule.get("outages", [])
                
                # Форматувати текст відключень
                if outages:
                    outage_text = ""
                    for outage in outages:
                        outage_text += f"   🔴 <b>{outage['start']} - {outage['end']}</b>\n"
                else:
                    outage_text = "   🟢 <b>Відключень не заплановано</b>\n"
                
                message = (
                    f"📅 <b>Графік на завтра опубліковано!</b>\n\n"
                    f"{self._format_location_block(user, formatted_group)}"
                    f"⏰ <b>Графік відключень:</b>\n"
                    f"{outage_text}"
                )
                
                await self.bot.send_message(
                    chat_id=user_id,
                    text=message,
                    parse_mode=ParseMode.HTML
                )
                
                await asyncio.sleep(0.5)
                
            except Exception as e:
                print(f"Error sending tomorrow notification to {user.get('user_id')}: {e}")
    
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
            
            await self.bot.send_message(
                chat_id=user_id,
                text=message,
                parse_mode=ParseMode.HTML
            )
            
            return True
            
        except Exception as e:
            print(f"Error sending schedule to user {user_id}: {e}")
            return False


# Will be initialized in main.py
notification_service: Optional[NotificationService] = None

