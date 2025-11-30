"""
Database module for storing user data and preferences
"""
import aiosqlite
import os
from typing import Optional, List, Dict, Any
from config import DATABASE_PATH


class Database:
    """Клас для роботи з базою даних SQLite"""
    
    def __init__(self):
        self.db_path = DATABASE_PATH
        # Створити директорію якщо не існує
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
    
    async def init_db(self):
        """Ініціалізувати базу даних та створити таблиці"""
        async with aiosqlite.connect(self.db_path) as db:
            # Таблиця користувачів
            await db.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    user_id INTEGER PRIMARY KEY,
                    username TEXT,
                    first_name TEXT,
                    last_name TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    notifications_enabled BOOLEAN DEFAULT 0
                )
            """)
            
            # Таблиця адрес користувачів
            await db.execute("""
                CREATE TABLE IF NOT EXISTS user_addresses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    otg_id INTEGER,
                    otg_name TEXT,
                    city_id INTEGER NOT NULL,
                    city_name TEXT NOT NULL,
                    street_id INTEGER NOT NULL,
                    street_name TEXT NOT NULL,
                    building_name TEXT NOT NULL,
                    cherg_gpv TEXT,
                    is_primary BOOLEAN DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(user_id)
                )
            """)
            
            # Таблиця для збереження останнього графіку (для сповіщень)
            await db.execute("""
                CREATE TABLE IF NOT EXISTS schedule_cache (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    image_url TEXT,
                    raw_html TEXT,
                    last_check TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            await db.commit()
    
    async def add_user(self, user_id: int, username: str = None, 
                       first_name: str = None, last_name: str = None) -> bool:
        """Додати нового користувача"""
        async with aiosqlite.connect(self.db_path) as db:
            try:
                await db.execute("""
                    INSERT OR REPLACE INTO users (user_id, username, first_name, last_name)
                    VALUES (?, ?, ?, ?)
                """, (user_id, username, first_name, last_name))
                await db.commit()
                return True
            except Exception as e:
                print(f"Error adding user: {e}")
                return False
    
    async def get_user(self, user_id: int) -> Optional[Dict]:
        """Отримати дані користувача"""
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT * FROM users WHERE user_id = ?", (user_id,)
            ) as cursor:
                row = await cursor.fetchone()
                return dict(row) if row else None
    
    async def save_user_address(self, user_id: int, otg_id: int, otg_name: str,
                                city_id: int, city_name: str, street_id: int,
                                street_name: str, building_name: str, 
                                cherg_gpv: str) -> bool:
        """Зберегти адресу користувача"""
        async with aiosqlite.connect(self.db_path) as db:
            try:
                # Спочатку скинути primary для всіх адрес користувача
                await db.execute(
                    "UPDATE user_addresses SET is_primary = 0 WHERE user_id = ?",
                    (user_id,)
                )
                
                # Перевірити чи така адреса вже існує
                async with db.execute("""
                    SELECT id FROM user_addresses 
                    WHERE user_id = ? AND city_id = ? AND street_id = ? AND building_name = ?
                """, (user_id, city_id, street_id, building_name)) as cursor:
                    existing = await cursor.fetchone()
                
                if existing:
                    # Оновити існуючу адресу
                    await db.execute("""
                        UPDATE user_addresses 
                        SET is_primary = 1, cherg_gpv = ?, otg_id = ?, otg_name = ?
                        WHERE id = ?
                    """, (cherg_gpv, otg_id, otg_name, existing[0]))
                else:
                    # Додати нову адресу
                    await db.execute("""
                        INSERT INTO user_addresses 
                        (user_id, otg_id, otg_name, city_id, city_name, street_id, 
                         street_name, building_name, cherg_gpv, is_primary)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                    """, (user_id, otg_id, otg_name, city_id, city_name, 
                          street_id, street_name, building_name, cherg_gpv))
                
                await db.commit()
                return True
            except Exception as e:
                print(f"Error saving address: {e}")
                return False
    
    async def get_user_address(self, user_id: int) -> Optional[Dict]:
        """Отримати основну адресу користувача"""
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("""
                SELECT * FROM user_addresses 
                WHERE user_id = ? AND is_primary = 1
            """, (user_id,)) as cursor:
                row = await cursor.fetchone()
                return dict(row) if row else None
    
    async def get_all_user_addresses(self, user_id: int) -> List[Dict]:
        """Отримати всі адреси користувача"""
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("""
                SELECT * FROM user_addresses WHERE user_id = ?
                ORDER BY is_primary DESC, created_at DESC
            """, (user_id,)) as cursor:
                rows = await cursor.fetchall()
                return [dict(row) for row in rows]
    
    async def delete_user_address(self, address_id: int, user_id: int) -> bool:
        """Видалити адресу"""
        async with aiosqlite.connect(self.db_path) as db:
            try:
                await db.execute(
                    "DELETE FROM user_addresses WHERE id = ? AND user_id = ?",
                    (address_id, user_id)
                )
                await db.commit()
                return True
            except Exception as e:
                print(f"Error deleting address: {e}")
                return False
    
    async def set_notifications(self, user_id: int, enabled: bool) -> bool:
        """Увімкнути/вимкнути сповіщення для користувача"""
        async with aiosqlite.connect(self.db_path) as db:
            try:
                await db.execute(
                    "UPDATE users SET notifications_enabled = ? WHERE user_id = ?",
                    (enabled, user_id)
                )
                await db.commit()
                return True
            except Exception as e:
                print(f"Error setting notifications: {e}")
                return False
    
    async def get_users_with_notifications(self) -> List[Dict]:
        """Отримати всіх користувачів з увімкненими сповіщеннями"""
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("""
                SELECT u.user_id, ua.cherg_gpv, ua.city_name, ua.street_name, ua.building_name
                FROM users u
                JOIN user_addresses ua ON u.user_id = ua.user_id
                WHERE u.notifications_enabled = 1 AND ua.is_primary = 1
            """) as cursor:
                rows = await cursor.fetchall()
                return [dict(row) for row in rows]
    
    async def get_last_schedule_hash(self) -> Optional[str]:
        """Отримати хеш останнього графіку"""
        async with aiosqlite.connect(self.db_path) as db:
            async with db.execute("""
                SELECT image_url FROM schedule_cache 
                ORDER BY last_check DESC LIMIT 1
            """) as cursor:
                row = await cursor.fetchone()
                return row[0] if row else None
    
    async def save_schedule_hash(self, image_url: str, raw_html: str = None) -> bool:
        """Зберегти хеш нового графіку"""
        async with aiosqlite.connect(self.db_path) as db:
            try:
                await db.execute("""
                    INSERT INTO schedule_cache (image_url, raw_html)
                    VALUES (?, ?)
                """, (image_url, raw_html))
                await db.commit()
                return True
            except Exception as e:
                print(f"Error saving schedule hash: {e}")
                return False


# Singleton instance
db = Database()
