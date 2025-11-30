"""
API Service для взаємодії з API Львівобленерго
"""
import aiohttp
from typing import Optional, List, Dict, Any
from config import LOE_API_BASE, LOE_MAIN_API_BASE


class LoeApiService:
    """Сервіс для роботи з API Львівобленерго"""
    
    def __init__(self):
        self.power_api_base = LOE_API_BASE
        self.main_api_base = LOE_MAIN_API_BASE
        self._session: Optional[aiohttp.ClientSession] = None
    
    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                headers={"Content-Type": "application/json"}
            )
        return self._session
    
    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()
    
    async def _make_request(self, url: str) -> Optional[Dict[str, Any]]:
        """Виконати HTTP запит"""
        try:
            session = await self._get_session()
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as response:
                if response.status == 200:
                    return await response.json()
                return None
        except Exception as e:
            print(f"API request error: {e}")
            return None
    
    async def get_otgs(self) -> List[Dict]:
        """Отримати список ОТГ (Об'єднаних Територіальних Громад)"""
        url = f"{self.power_api_base}/pw_otgs?pagination=false"
        data = await self._make_request(url)
        if data and "hydra:member" in data:
            return data["hydra:member"]
        return []
    
    async def get_cities(self, otg_id: Optional[str] = None) -> List[Dict]:
        """Отримати список міст (опціонально за ОТГ)"""
        url = f"{self.power_api_base}/pw_cities?pagination=false"
        if otg_id:
            url += f"&otg.id={otg_id}"
        data = await self._make_request(url)
        if data and "hydra:member" in data:
            return data["hydra:member"]
        return []
    
    async def get_streets(self, city_id: int) -> List[Dict]:
        """Отримати список вулиць для міста"""
        url = f"{self.power_api_base}/pw_streets?pagination=false&city.id={city_id}"
        data = await self._make_request(url)
        if data and "hydra:member" in data:
            return data["hydra:member"]
        return []
    
    async def get_accounts(self, city_id: int, street_id: int, building_name: Optional[str] = None) -> List[Dict]:
        """Отримати список будинків та їх черг відключень"""
        url = f"{self.power_api_base}/pw_accounts?pagination=false&city.id={city_id}&street.id={street_id}"
        if building_name:
            url += f"&buildingName={building_name}"
        data = await self._make_request(url)
        if data and "hydra:member" in data:
            return data["hydra:member"]
        return []
    
    async def get_schedule_group(self, cherg_gpv: str) -> str:
        """Перетворити номер черги ГПВ у читабельний формат"""
        # cherg_gpv зазвичай "62" означає групу 6.2
        if not cherg_gpv or cherg_gpv == "0" or len(cherg_gpv) > 2:
            return "Не входить"
        return ".".join(cherg_gpv)
    
    async def get_current_grafics(self) -> Dict[str, Any]:
        """Отримати поточні графіки відключень"""
        url = f"{self.main_api_base}/pages?page=1&synonym=power-top"
        data = await self._make_request(url)
        if data and "hydra:member" in data and len(data["hydra:member"]) > 0:
            return data["hydra:member"][0]
        return {}
    
    async def get_gpv_groups(self) -> List[Dict]:
        """Отримати список груп ГПВ з зображеннями"""
        url = f"{self.main_api_base}/gpv_groups?pagination=false"
        data = await self._make_request(url)
        if data and "hydra:member" in data:
            return data["hydra:member"]
        return []
    
    async def get_sync_time(self) -> Optional[str]:
        """Отримати час останньої синхронізації"""
        url = f"{self.power_api_base}/options?option_key=successful_last_synk"
        data = await self._make_request(url)
        if data and "hydra:member" in data and len(data["hydra:member"]) > 0:
            return data["hydra:member"][0].get("optionValue")
        return None
    
    async def get_schedule_info(self, city_id: int, street_id: int, building_name: str) -> Optional[Dict]:
        """Отримати повну інформацію про графік для адреси"""
        accounts = await self.get_accounts(city_id, street_id, building_name)
        if accounts:
            account = accounts[0]
            cherg_gpv = account.get("chergGpv", "")
            return {
                "chergGpv": cherg_gpv,
                "chergGpvFormatted": await self.get_schedule_group(cherg_gpv),
                "chergGav": account.get("chergGav", ""),
                "chergAchr": account.get("chergAchr", ""),
                "chergGvsp": account.get("chergGvsp", ""),
                "chergSgav": account.get("chergSgav", ""),
                "disconnectionTask": account.get("disconnectionTask", False)
            }
        return None


# Singleton instance
api_service = LoeApiService()
