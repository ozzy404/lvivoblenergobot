"""Firebase integration helpers"""
from __future__ import annotations

import aiohttp
from typing import Optional, Dict, Any

from config import FIREBASE_DATABASE_URL


class FirebaseService:
    """Minimal async client for fetching user profiles from Firebase Realtime Database"""

    def __init__(self) -> None:
        self._session: Optional[aiohttp.ClientSession] = None
        self.database_url = FIREBASE_DATABASE_URL

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()

    async def get_user_profile(self, user_id: int) -> Optional[Dict[str, Any]]:
        """Fetch user profile JSON from Firebase Realtime Database"""
        if not self.database_url:
            print(f"[FIREBASE] No database URL configured")
            return None

        # Firebase Realtime Database REST API
        url = f"{self.database_url}/users/{user_id}.json"
        
        print(f"[FIREBASE] Fetching user {user_id} from {url}")

        try:
            session = await self._get_session()
            async with session.get(
                url,
                timeout=aiohttp.ClientTimeout(total=15)
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    if not data:
                        print(f"[FIREBASE] No data for user {user_id}")
                        return None
                    if isinstance(data, dict):
                        print(f"[FIREBASE] Got data for user {user_id}: {data}")
                        return data
                    print(f"[FIREBASE] Unexpected payload for user {user_id}: {data}")
                elif resp.status == 404:
                    print(f"[FIREBASE] User {user_id} not found")
                    return None
                else:
                    body = await resp.text()
                    print(f"[FIREBASE] Unexpected status {resp.status} for user {user_id}: {body}")
        except Exception as exc:
            print(f"[FIREBASE] Error fetching user {user_id}: {exc}")
        return None

    async def save_user_profile(self, user_id: int, data: Dict[str, Any]) -> bool:
        """Save user profile to Firebase Realtime Database"""
        if not self.database_url:
            return False

        url = f"{self.database_url}/users/{user_id}.json"

        try:
            session = await self._get_session()
            async with session.patch(
                url,
                json=data,
                timeout=aiohttp.ClientTimeout(total=15)
            ) as resp:
                if resp.status == 200:
                    print(f"[FIREBASE] Saved data for user {user_id}")
                    return True
                else:
                    body = await resp.text()
                    print(f"[FIREBASE] Error saving user {user_id}: {resp.status} - {body}")
        except Exception as exc:
            print(f"[FIREBASE] Error saving user {user_id}: {exc}")
        return False

    async def set_notifications(self, user_id: int, enabled: bool) -> bool:
        """Set notifications_enabled for user in Firebase"""
        if not self.database_url:
            return False

        url = f"{self.database_url}/users/{user_id}/notifications_enabled.json"

        try:
            session = await self._get_session()
            async with session.put(
                url,
                json=enabled,
                timeout=aiohttp.ClientTimeout(total=15)
            ) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            pass
        return False

    async def save_notification_settings(self, user_id: int, settings: Dict[str, Any]) -> bool:
        """Зберегти налаштування сповіщень користувача"""
        if not self.database_url:
            return False

        url = f"{self.database_url}/users/{user_id}/notification_settings.json"

        try:
            session = await self._get_session()
            async with session.put(
                url,
                json=settings,
                timeout=aiohttp.ClientTimeout(total=15)
            ) as resp:
                return resp.status == 200
        except Exception:
            pass
        return False

    async def get_notification_settings(self, user_id: int) -> Optional[Dict[str, Any]]:
        """Отримати налаштування сповіщень користувача"""
        if not self.database_url:
            return None

        url = f"{self.database_url}/users/{user_id}/notification_settings.json"

        try:
            session = await self._get_session()
            async with session.get(
                url,
                timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                if resp.status == 200:
                    return await resp.json()
        except Exception:
            pass
        return None

    async def delete_user_profile(self, user_id: int) -> bool:
        """Delete user profile from Firebase Realtime Database"""
        if not self.database_url:
            return False

        url = f"{self.database_url}/users/{user_id}.json"

        try:
            session = await self._get_session()
            async with session.delete(
                url,
                timeout=aiohttp.ClientTimeout(total=15)
            ) as resp:
                if resp.status == 200:
                    print(f"[FIREBASE] Deleted user {user_id}")
                    return True
                else:
                    body = await resp.text()
                    print(f"[FIREBASE] Error deleting user {user_id}: {resp.status} - {body}")
        except Exception as exc:
            print(f"[FIREBASE] Error deleting user {user_id}: {exc}")
        return False

    async def get_all_users_with_notifications(self) -> list:
        """Get all users who have notifications enabled"""
        if not self.database_url:
            return []

        url = f"{self.database_url}/users.json"
        # Firebase query to filter by notifications_enabled
        params = {
            'orderBy': '"notifications_enabled"',
            'equalTo': 'true'
        }

        try:
            session = await self._get_session()
            async with session.get(
                url,
                params=params,
                timeout=aiohttp.ClientTimeout(total=30)
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    if not data:
                        return []
                    
                    users = []
                    for user_id, user_data in data.items():
                        if isinstance(user_data, dict) and user_data.get("cherg_gpv"):
                            user_data["user_id"] = int(user_id)
                            users.append(user_data)
                    
                    print(f"[FIREBASE] Found {len(users)} users with notifications")
                    return users
                else:
                    body = await resp.text()
                    print(f"[FIREBASE] Error getting users: {resp.status} - {body}")
        except Exception as exc:
            print(f"[FIREBASE] Error getting users with notifications: {exc}")
        return []


firebase_service = FirebaseService()
