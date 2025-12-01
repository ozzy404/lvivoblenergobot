"""
Notification service for checking and sending schedule updates
"""
import asyncio
from datetime import datetime, time
from typing import Optional
from telegram import Bot
from telegram.constants import ParseMode

from api_service import api_service
from database import db
from config import CHECK_INTERVAL


class NotificationService:
    """Сервіс для відправки сповіщень про зміни в графіку"""
    
    def __init__(self, bot: Bot):
        self.bot = bot
        self.running = False
        self.last_image_url: Optional[str] = None
        self._tasks = []
    
    async def start(self):
        """Запустити сервіс сповіщень"""
        self.running = True
        print("🔔 Notification service started")
        
        # Отримати останній збережений хеш
        self.last_image_url = await db.get_last_schedule_hash()
        
        # Запустити фонові задачі
        self._tasks = [
            asyncio.create_task(self._check_for_updates_loop()),
            asyncio.create_task(self._schedule_morning_notifications()),
            asyncio.create_task(self._schedule_tomorrow_notifications())
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
    
    async def _schedule_morning_notifications(self):
        """Відправляти ранкові сповіщення з графіком на сьогодні о 7:00"""
        while self.running:
            try:
                now = datetime.now()
                target_time = time(7, 0)
                
                if now.time().hour == target_time.hour and now.time().minute == target_time.minute:
                    await self._send_today_schedule_to_all()
                    await asyncio.sleep(60)
                else:
                    await asyncio.sleep(30)
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"Error in morning notifications: {e}")
                await asyncio.sleep(60)
    
    async def _schedule_tomorrow_notifications(self):
        """Відправляти сповіщення про графік на завтра о 18:00"""
        while self.running:
            try:
                now = datetime.now()
                target_time = time(18, 0)
                
                if now.time().hour == target_time.hour and now.time().minute == target_time.minute:
                    await self._send_tomorrow_schedule_to_all()
                    await asyncio.sleep(60)
                else:
                    await asyncio.sleep(30)
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"Error in tomorrow notifications: {e}")
                await asyncio.sleep(60)
    
    async def _send_today_schedule_to_all(self):
        """Відправити графік на сьогодні всім користувачам"""
        users = await db.get_users_with_notifications()
        
        if not users:
            return
        
        schedule = await api_service.get_schedule_image_for_today()
        
        if not schedule:
            print("No schedule available for today")
            return
        
        print(f"📢 Sending today's schedule to {len(users)} users...")
        
        for user_data in users:
            user_id = user_data["user_id"]
            
            # Перевірити чи вже відправляли сьогодні
            if await db.check_notification_sent(user_id, "daily_schedule", schedule.get("date")):
                continue
            
            try:
                await self._send_schedule_message(user_id, user_data, schedule, "🌅", "на сьогодні")
                await db.mark_notification_sent(user_id, "daily_schedule", schedule.get("date"))
                await asyncio.sleep(0.5)
            except Exception as e:
                print(f"Error sending schedule to user {user_id}: {e}")
    
    async def _send_tomorrow_schedule_to_all(self):
        """Відправити графік на завтра всім користувачам"""
        users = await db.get_users_with_notifications()
        
        if not users:
            return
        
        schedule = await api_service.get_schedule_image_for_tomorrow()
        
        if not schedule:
            print("No schedule available for tomorrow yet")
            return
        
        print(f"📢 Sending tomorrow's schedule to {len(users)} users...")
        
        for user_data in users:
            user_id = user_data["user_id"]
            
            if await db.check_notification_sent(user_id, "tomorrow_schedule", schedule.get("date")):
                continue
            
            try:
                await self._send_schedule_message(user_id, user_data, schedule, "🌆", "на завтра")
                await db.mark_notification_sent(user_id, "tomorrow_schedule", schedule.get("date"))
                await asyncio.sleep(0.5)
            except Exception as e:
                print(f"Error sending tomorrow schedule to user {user_id}: {e}")
    
    async def _send_schedule_message(self, user_id: int, user_data: dict, schedule: dict, icon: str, period: str):
        """Відправити повідомлення з графіком"""
        cherg_gpv = user_data.get("cherg_gpv", "")
        formatted_group = await api_service.get_schedule_group(cherg_gpv)
        
        message = (
            f"{icon} <b>Графік погодинних відключень {period}</b>\n\n"
            f"📍 <b>Ваша адреса:</b>\n"
            f"   {user_data['city_name']}, {user_data['street_name']}, {user_data['building_name']}\n\n"
            f"⚡ <b>Ваша група ГПВ:</b> {formatted_group}\n\n"
            f"Перевірте графік на зображенні нижче 👇"
        )
        
        await self.bot.send_photo(
            chat_id=user_id,
            photo=schedule["image_url"],
            caption=message,
            parse_mode=ParseMode.HTML
        )
    
    async def check_for_updates(self):
        """Перевірити наявність оновлень графіку"""
        try:
            grafics = await api_service.get_current_grafics()
            
            if not grafics:
                return
            
            current_image_url = grafics.get("imageUrl", "")
            raw_html = grafics.get("rawHtml", "")
            schedule_date = grafics.get("date", "")
            
            if not current_image_url:
                return
            
            full_image_url = f"https://api.loe.lviv.ua{current_image_url}"
            
            # Перевірити чи змінився графік
            if self.last_image_url and full_image_url != self.last_image_url:
                print(f"📢 Schedule updated: {full_image_url}")
                
                # Зберегти новий хеш
                is_new = await db.save_schedule_hash(schedule_date, full_image_url, raw_html)
                
                if is_new:
                    await self.send_change_notifications(full_image_url)
            
            self.last_image_url = full_image_url
                
        except Exception as e:
            print(f"Error checking for updates: {e}")
    
    async def send_change_notifications(self, image_url: str):
        """Відправити сповіщення всім підписаним користувачам про зміни"""
        users = await db.get_users_with_notifications()
        
        if not users:
            return
        
        print(f"📢 Sending change notifications to {len(users)} users...")
        
        for user in users:
            try:
                cherg_gpv = user.get("cherg_gpv", "")
                formatted_group = await api_service.get_schedule_group(cherg_gpv)
                
                message = (
                    f"⚠️ <b>УВАГА! Графік відключень змінився!</b>\n\n"
                    f"📍 Ваша адреса: {user['city_name']}, {user['street_name']}, {user['building_name']}\n"
                    f"⚡ Група ГПВ: <b>{formatted_group}</b>\n\n"
                    f"Перегляньте новий графік нижче 👇"
                )
                
                await self.bot.send_photo(
                    chat_id=user["user_id"],
                    photo=image_url,
                    caption=message,
                    parse_mode=ParseMode.HTML
                )
                
                await asyncio.sleep(0.5)
                
            except Exception as e:
                print(f"Error sending notification to {user['user_id']}: {e}")
    
    async def send_schedule_to_user(self, user_id: int) -> bool:
        """Відправити поточний графік конкретному користувачу"""
        try:
            address = await db.get_user_address(user_id)
            
            if not address:
                await self.bot.send_message(
                    chat_id=user_id,
                    text="❌ Ви ще не налаштували свою адресу.\n"
                         "Натисніть кнопку 'Налаштувати адресу' щоб обрати своє місто, вулицю та будинок.",
                    parse_mode=ParseMode.HTML
                )
                return False
            
            grafics = await api_service.get_current_grafics()
            
            if not grafics or not grafics.get("imageUrl"):
                await self.bot.send_message(
                    chat_id=user_id,
                    text="⚠️ Наразі немає доступних графіків відключень.",
                    parse_mode=ParseMode.HTML
                )
                return False
            
            image_url = grafics.get("imageUrl", "")
            full_image_url = f"https://api.loe.lviv.ua{image_url}"
            
            cherg_gpv = address.get("cherg_gpv", "")
            formatted_group = await api_service.get_schedule_group(cherg_gpv)
            
            sync_time = await api_service.get_sync_time()
            sync_info = f"\n🕐 Оновлено: {sync_time}" if sync_time else ""
            
            message = (
                f"⚡ <b>Графік погодинних відключень</b>\n\n"
                f"📍 <b>Ваша адреса:</b>\n"
                f"   {address['city_name']}, {address['street_name']}, {address['building_name']}\n\n"
                f"🔌 <b>Ваша група ГПВ:</b> {formatted_group}\n"
                f"{sync_info}"
            )
            
            await self.bot.send_photo(
                chat_id=user_id,
                photo=full_image_url,
                caption=message,
                parse_mode=ParseMode.HTML
            )
            
            return True
            
        except Exception as e:
            print(f"Error sending schedule to user {user_id}: {e}")
            return False


# Will be initialized in main.py
notification_service: Optional[NotificationService] = None

