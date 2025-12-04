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
        """Return context from Firebase first, then fallback to local DB"""
        
        # Спочатку перевіряємо Firebase (пріоритет)
        firebase_context = await self._get_from_firebase(user_id)
        if firebase_context and firebase_context.get("cherg_gpv"):
            print(f"[CONTEXT] Got context from Firebase for user {user_id}")
            return firebase_context
        
        # Якщо в Firebase немає, перевіряємо локальну БД
        local_context = await db.get_schedule_context(user_id)
        if local_context and local_context.get("cherg_gpv"):
            print(f"[CONTEXT] Got context from local DB for user {user_id}")
            return local_context
        
        print(f"[CONTEXT] No context found for user {user_id}")
        return None

    async def _get_from_firebase(self, user_id: int) -> Optional[Dict[str, Any]]:
        """Get user context from Firebase"""
        profile = await firebase_service.get_user_profile(user_id)
        if not profile:
            return None

        cherg_gpv = _pick(profile, "cherg_gpv", "chergGpv", "group", "group_code", "groupCode", "gpv")
        if not cherg_gpv:
            return None

        city_name = _pick(profile, "city_name", "cityName")
        street_name = _pick(profile, "street_name", "streetName")
        building_name = _pick(profile, "building_name", "buildingName", "building")

        return {
            "context_type": "address" if city_name else "manual",
            "cherg_gpv": cherg_gpv,
            "city_name": city_name,
            "street_name": street_name,
            "building_name": building_name,
            "label": _build_label(city_name, street_name, building_name, None)
        }


user_context_service = UserContextService()
