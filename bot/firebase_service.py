"""Firebase integration helpers"""
from __future__ import annotations

import aiohttp
from typing import Optional, Dict, Any

from config import FIREBASE_USER_ENDPOINT, FIREBASE_AUTH_TOKEN


class FirebaseService:
    """Minimal async client for fetching user profiles from Firebase"""

    def __init__(self) -> None:
        self._session: Optional[aiohttp.ClientSession] = None
        self.user_endpoint_template = FIREBASE_USER_ENDPOINT
        self.auth_token = FIREBASE_AUTH_TOKEN

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()

    async def get_user_profile(self, user_id: int) -> Optional[Dict[str, Any]]:
        """Fetch user profile JSON from Firebase Realtime DB/Functions endpoint"""
        if not self.user_endpoint_template:
            return None

        try:
            url = self.user_endpoint_template.format(user_id=user_id)
        except Exception as exc:
            print(f"[FIREBASE] Invalid endpoint template: {exc}")
            return None

        params = {}
        if self.auth_token:
            params["auth"] = self.auth_token

        try:
            session = await self._get_session()
            async with session.get(
                url,
                params=params,
                timeout=aiohttp.ClientTimeout(total=15)
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    if not data:
                        return None
                    if isinstance(data, dict):
                        return data
                    print(f"[FIREBASE] Unexpected payload for user {user_id}: {data}")
                elif resp.status == 404:
                    return None
                else:
                    body = await resp.text()
                    print(f"[FIREBASE] Unexpected status {resp.status} for user {user_id}: {body}")
        except Exception as exc:
            print(f"[FIREBASE] Error fetching user {user_id}: {exc}")
        return None


firebase_service = FirebaseService()
