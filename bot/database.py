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
        print(f"[DB] Database path: {self.db_path}")
    
    async def init_db(self):
        """Ініціалізувати базу даних та створити таблиці"""
        print(f"[DB] Initializing database at {self.db_path}")
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
                    schedule_date TEXT NOT NULL,
                    image_url TEXT,
                    raw_html TEXT,
                    last_check TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Таблиця для збереження історії графіків
            await db.execute("""
                CREATE TABLE IF NOT EXISTS schedule_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    schedule_date TEXT NOT NULL,
                    image_url TEXT,
                    raw_html TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(schedule_date, image_url)
                )
            """)
            
            # Таблиця для відстеження відправлених сповіщень
            await db.execute("""
                CREATE TABLE IF NOT EXISTS sent_notifications (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    notification_type TEXT NOT NULL,
                    schedule_date TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(user_id)
                )
            """)
            
            # Таблиця для користувацьких груп (коли користувач задає групу вручну)
            await db.execute("""
                CREATE TABLE IF NOT EXISTS user_manual_groups (
                    user_id INTEGER PRIMARY KEY,
                    group_code TEXT NOT NULL,
                    label TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(user_id)
                )
            """)
            
            # Таблиця для хешів графіків по користувачах (для уникнення повторних сповіщень)
            await db.execute("""
                CREATE TABLE IF NOT EXISTS user_schedule_hashes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    schedule_date TEXT NOT NULL,
                    schedule_hash TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, schedule_date),
                    FOREIGN KEY (user_id) REFERENCES users(user_id)
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
        print(f"[DB] Saving address for user {user_id}: city_id={city_id}, street_id={street_id}, building={building_name}, cherg_gpv={cherg_gpv}")
        async with aiosqlite.connect(self.db_path) as db:
            try:
                # Спочатку перевірити чи існує користувач, якщо ні - створити
                async with db.execute(
                    "SELECT user_id FROM users WHERE user_id = ?", (user_id,)
                ) as cursor:
                    if not await cursor.fetchone():
                        print(f"[DB] User {user_id} not found, creating...")
                        await db.execute(
                            "INSERT INTO users (user_id) VALUES (?)", (user_id,)
                        )
                
                # Скинути primary для всіх адрес користувача
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
                    print(f"[DB] Updating existing address id={existing[0]}")
                    await db.execute("""
                        UPDATE user_addresses 
                        SET is_primary = 1, cherg_gpv = ?, otg_id = ?, otg_name = ?
                        WHERE id = ?
                    """, (cherg_gpv, otg_id, otg_name, existing[0]))
                else:
                    # Додати нову адресу
                    print(f"[DB] Inserting new address for user {user_id}")
                    await db.execute("""
                        INSERT INTO user_addresses 
                        (user_id, otg_id, otg_name, city_id, city_name, street_id, 
                         street_name, building_name, cherg_gpv, is_primary)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                    """, (user_id, otg_id, otg_name, city_id, city_name, 
                          street_id, street_name, building_name, cherg_gpv))
                
                await db.commit()
                print(f"[DB] Address saved successfully for user {user_id}")

                # Якщо користувач зберігає адресу через WebApp, видалити ручну групу
                await self.clear_manual_group(user_id)
                return True
            except Exception as e:
                print(f"[DB] Error saving address: {e}")
                import traceback
                traceback.print_exc()
                return False

    async def get_manual_group(self, user_id: int) -> Optional[Dict]:
        """Отримати вручну налаштовану групу користувача"""
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT * FROM user_manual_groups WHERE user_id = ?",
                (user_id,)
            ) as cursor:
                row = await cursor.fetchone()
                return dict(row) if row else None

    async def set_manual_group(self, user_id: int, group_code: str,
                               label: Optional[str] = None) -> bool:
        """Зберегти користувацьку групу ГПВ"""
        label = label.strip() if label else None
        async with aiosqlite.connect(self.db_path) as db:
            try:
                async with db.execute(
                    "SELECT user_id FROM users WHERE user_id = ?",
                    (user_id,)
                ) as cursor:
                    if not await cursor.fetchone():
                        await db.execute(
                            "INSERT INTO users (user_id) VALUES (?)",
                            (user_id,)
                        )

                await db.execute(
                    """
                    INSERT INTO user_manual_groups (user_id, group_code, label, updated_at)
                    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(user_id) DO UPDATE SET
                        group_code = excluded.group_code,
                        label = excluded.label,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    (user_id, group_code, label)
                )
                await db.commit()
                return True
            except Exception as e:
                print(f"Error saving manual group: {e}")
                return False

    async def clear_manual_group(self, user_id: int) -> None:
        """Видалити користувацьку групу"""
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "DELETE FROM user_manual_groups WHERE user_id = ?",
                (user_id,)
            )
            await db.commit()

    async def get_schedule_context(self, user_id: int) -> Optional[Dict]:
        """Отримати контекст (адресу або ручну групу) для показу графіка"""
        address = await self.get_user_address(user_id)
        if address:
            address["context_type"] = "address"
            return address

        manual = await self.get_manual_group(user_id)
        if manual:
            return {
                "context_type": "manual",
                "cherg_gpv": manual.get("group_code", ""),
                "label": manual.get("label"),
                "city_name": None,
                "street_name": None,
                "building_name": None
            }
        return None
    
    async def get_user_address(self, user_id: int) -> Optional[Dict]:
        """Отримати основну адресу користувача"""
        print(f"[DB] Getting address for user {user_id}")
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("""
                SELECT * FROM user_addresses 
                WHERE user_id = ? AND is_primary = 1
            """, (user_id,)) as cursor:
                row = await cursor.fetchone()
                result = dict(row) if row else None
                print(f"[DB] Address for user {user_id}: {result}")
                return result
    
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
            users: List[Dict[str, Any]] = []

            async with db.execute("""
                SELECT u.user_id, ua.cherg_gpv, ua.city_name, ua.street_name, ua.building_name
                FROM users u
                JOIN user_addresses ua ON u.user_id = ua.user_id
                WHERE u.notifications_enabled = 1 AND ua.is_primary = 1
            """) as cursor:
                rows = await cursor.fetchall()
                for row in rows:
                    data = dict(row)
                    data["context_type"] = "address"
                    users.append(data)

            existing_ids = {user["user_id"] for user in users}

            async with db.execute("""
                SELECT u.user_id, mg.group_code, mg.label
                FROM users u
                JOIN user_manual_groups mg ON u.user_id = mg.user_id
                WHERE u.notifications_enabled = 1
            """) as cursor:
                rows = await cursor.fetchall()
                for row in rows:
                    user_id = row["user_id"]
                    if user_id in existing_ids:
                        continue
                    users.append({
                        "user_id": user_id,
                        "cherg_gpv": row["group_code"],
                        "city_name": None,
                        "street_name": None,
                        "building_name": None,
                        "label": row["label"],
                        "context_type": "manual"
                    })

            return users
    
    async def get_last_schedule_hash(self, schedule_type: str = None) -> Optional[str]:
        """Отримати хеш останнього графіку (today або tomorrow)"""
        async with aiosqlite.connect(self.db_path) as db:
            if schedule_type:
                async with db.execute("""
                    SELECT image_url FROM schedule_cache 
                    WHERE schedule_date LIKE ?
                    ORDER BY last_check DESC LIMIT 1
                """, (f"%{schedule_type}%",)) as cursor:
                    row = await cursor.fetchone()
                    return row[0] if row else None
            else:
                async with db.execute("""
                    SELECT image_url FROM schedule_cache 
                    ORDER BY last_check DESC LIMIT 1
                """) as cursor:
                    row = await cursor.fetchone()
                    return row[0] if row else None
    
    async def get_user_group_hash(self, user_id: int, schedule_date: str) -> Optional[str]:
        """Отримати збережений хеш графіку для користувача"""
        async with aiosqlite.connect(self.db_path) as db:
            async with db.execute("""
                SELECT schedule_hash FROM user_schedule_hashes 
                WHERE user_id = ? AND schedule_date = ?
            """, (user_id, schedule_date)) as cursor:
                row = await cursor.fetchone()
                return row[0] if row else None
    
    async def save_user_group_hash(self, user_id: int, schedule_date: str, schedule_hash: str) -> bool:
        """Зберегти хеш графіку для користувача"""
        async with aiosqlite.connect(self.db_path) as db:
            try:
                await db.execute("""
                    INSERT OR REPLACE INTO user_schedule_hashes 
                    (user_id, schedule_date, schedule_hash, created_at)
                    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                """, (user_id, schedule_date, schedule_hash))
                await db.commit()
                return True
            except Exception as e:
                print(f"Error saving user schedule hash: {e}")
                return False
    
    async def save_schedule_hash(self, schedule_date: str, image_url: str, raw_html: str = None) -> bool:
        """Зберегти хеш нового графіку"""
        async with aiosqlite.connect(self.db_path) as db:
            try:
                # Перевірити чи вже існує такий графік
                async with db.execute("""
                    SELECT id FROM schedule_cache
                    WHERE schedule_date = ? AND image_url = ?
                """, (schedule_date, image_url)) as cursor:
                    existing = await cursor.fetchone()
                
                if not existing:
                    await db.execute("""
                        INSERT INTO schedule_cache (schedule_date, image_url, raw_html)
                        VALUES (?, ?, ?)
                    """, (schedule_date, image_url, raw_html))
                    
                    # Також зберегти в історію
                    await db.execute("""
                        INSERT OR IGNORE INTO schedule_history (schedule_date, image_url, raw_html)
                        VALUES (?, ?, ?)
                    """, (schedule_date, image_url, raw_html))
                    
                    await db.commit()
                    return True
                return False
            except Exception as e:
                print(f"Error saving schedule hash: {e}")
                return False
    
    async def check_notification_sent(self, user_id: int, notification_type: str, schedule_date: str = None) -> bool:
        """Перевірити чи було відправлено сповіщення користувачу"""
        async with aiosqlite.connect(self.db_path) as db:
            query = """
                SELECT id FROM sent_notifications 
                WHERE user_id = ? AND notification_type = ?
            """
            params = [user_id, notification_type]
            
            if schedule_date:
                query += " AND schedule_date = ?"
                params.append(schedule_date)
            
            query += " AND created_at >= date('now')"
            
            async with db.execute(query, tuple(params)) as cursor:
                row = await cursor.fetchone()
                return row is not None
    
    async def mark_notification_sent(self, user_id: int, notification_type: str, schedule_date: str = None) -> bool:
        """Позначити що сповіщення було відправлено"""
        async with aiosqlite.connect(self.db_path) as db:
            try:
                await db.execute("""
                    INSERT INTO sent_notifications (user_id, notification_type, schedule_date)
                    VALUES (?, ?, ?)
                """, (user_id, notification_type, schedule_date))
                await db.commit()
                return True
            except Exception as e:
                print(f"Error marking notification sent: {e}")
                return False


# Singleton instance
db = Database()
