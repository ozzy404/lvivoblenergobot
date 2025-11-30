"""
Notification service for checking and sending schedule updates
"""
import asyncio
from datetime import datetime
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
    
    async def start(self):
        """Запустити сервіс сповіщень"""
        self.running = True
        print("🔔 Notification service started")
        
        # Отримати останній збережений хеш
        self.last_image_url = await db.get_last_schedule_hash()
        
        while self.running:
            try:
                await self.check_for_updates()
            except Exception as e:
                print(f"Error in notification check: {e}")
            
            await asyncio.sleep(CHECK_INTERVAL * 60)  # Convert minutes to seconds
    
    async def stop(self):
        """Зупинити сервіс сповіщень"""
        self.running = False
        print("🔕 Notification service stopped")
    
    async def check_for_updates(self):
        """Перевірити наявність оновлень графіку"""
        try:
            grafics = await api_service.get_current_grafics()
            
            if not grafics:
                return
            
            # Отримати URL зображення графіку
            current_image_url = grafics.get("imageUrl", "")
            raw_html = grafics.get("rawHtml", "")
            
            if not current_image_url:
                return
            
            # Перевірити чи змінився графік
            if self.last_image_url and current_image_url != self.last_image_url:
                print(f"📢 Schedule updated: {current_image_url}")
                await self.send_notifications(current_image_url, raw_html)
            
            # Зберегти новий хеш
            if current_image_url != self.last_image_url:
                await db.save_schedule_hash(current_image_url, raw_html)
                self.last_image_url = current_image_url
                
        except Exception as e:
            print(f"Error checking for updates: {e}")
    
    async def send_notifications(self, image_url: str, raw_html: str):
        """Відправити сповіщення всім підписаним користувачам"""
        users = await db.get_users_with_notifications()
        
        if not users:
            return
        
        full_image_url = f"https://api.loe.lviv.ua{image_url}"
        
        for user in users:
            try:
                cherg_gpv = user.get("cherg_gpv", "")
                formatted_group = await api_service.get_schedule_group(cherg_gpv)
                
                message = (
                    f"🔔 <b>Оновлення графіку відключень!</b>\n\n"
                    f"📍 Ваша адреса: {user['city_name']}, {user['street_name']}, {user['building_name']}\n"
                    f"⚡ Ваша група: <b>{formatted_group}</b>\n\n"
                    f"Перегляньте новий графік за посиланням нижче."
                )
                
                # Відправити повідомлення з зображенням
                await self.bot.send_photo(
                    chat_id=user["user_id"],
                    photo=full_image_url,
                    caption=message,
                    parse_mode=ParseMode.HTML
                )
                
            except Exception as e:
                print(f"Error sending notification to {user['user_id']}: {e}")
    
    async def send_schedule_to_user(self, user_id: int) -> bool:
        """Відправити поточний графік конкретному користувачу"""
        try:
            # Отримати адресу користувача
            address = await db.get_user_address(user_id)
            
            if not address:
                await self.bot.send_message(
                    chat_id=user_id,
                    text="❌ Ви ще не налаштували свою адресу.\n"
                         "Натисніть кнопку 'Налаштувати адресу' щоб обрати своє місто, вулицю та будинок.",
                    parse_mode=ParseMode.HTML
                )
                return False
            
            # Отримати поточний графік
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
            
            # Отримати час синхронізації
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
