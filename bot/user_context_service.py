"""Utilities for resolving a user's schedule context"""
from __future__ import annotations

from typing import Optional, Dict, Any

from database import db
from firebase_service import firebase_service


def _pick(data: Dict[str, Any], *keys: str) -> Optional[str]:
    for key in keys:
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, (int, float)):
            return str(value)
    return None


def _build_label(city: Optional[str], street: Optional[str], building: Optional[str], fallback: Optional[str]) -> Optional[str]:
    parts = [part.strip() for part in (city, street, building) if part]
    if parts:
        return ", ".join(parts)
    return fallback.strip() if isinstance(fallback, str) and fallback.strip() else None


class UserContextService:
    async def get_context(self, user_id: int) -> Optional[Dict[str, Any]]:
        """Return cached context or try syncing from Firebase"""
        context = await db.get_schedule_context(user_id)
        if context and context.get("cherg_gpv"):
            return context

        synced = await self._sync_from_firebase(user_id)
        return synced or context

    async def _sync_from_firebase(self, user_id: int) -> Optional[Dict[str, Any]]:
        profile = await firebase_service.get_user_profile(user_id)
        if not profile:
            return None

        cherg_gpv = _pick(profile, "cherg_gpv", "chergGpv", "group", "group_code", "groupCode", "gpv")
        if not cherg_gpv:
            return None

        city_name = _pick(profile, "city_name", "cityName")
        street_name = _pick(profile, "street_name", "streetName")
        building_name = _pick(profile, "building_name", "buildingName", "building")
        label = _build_label(city_name, street_name, building_name, _pick(profile, "label", "name", "title"))

        await db.set_manual_group(user_id, cherg_gpv, label)
        return await db.get_schedule_context(user_id)


user_context_service = UserContextService()
