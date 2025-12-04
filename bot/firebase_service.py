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
            async with session.put(
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


firebase_service = FirebaseService()
