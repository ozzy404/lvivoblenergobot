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
        """Отримати поточні графіки відключень з меню"""
        url = f"{self.main_api_base}/menus?page=1&type=photo-grafic"
        data = await self._make_request(url)
        if data and "hydra:member" in data and len(data["hydra:member"]) > 0:
            menu = data["hydra:member"][0]
            menu_items = menu.get("menuItems", [])
            
            # Шукаємо Today (orders=0)
            for item in menu_items:
                if item.get("orders") == 0 or item.get("name") == "Today":
                    return {
                        "imageUrl": item.get("imageUrl", ""),
                        "rawHtml": item.get("rawHtml", ""),
                        "date": self._extract_date_from_html(item.get("rawHtml", "")),
                        "updateTime": self._extract_update_time(item.get("rawHtml", ""))
                    }
            
            # Якщо Today не знайдено, беремо перший елемент
            if menu_items:
                first_item = menu_items[0]
                return {
                    "imageUrl": first_item.get("imageUrl", ""),
                    "rawHtml": first_item.get("rawHtml", ""),
                    "date": self._extract_date_from_html(first_item.get("rawHtml", "")),
                    "updateTime": self._extract_update_time(first_item.get("rawHtml", ""))
                }
        return {}
    
    async def get_tomorrow_grafics(self) -> Dict[str, Any]:
        """Отримати графіки на завтра"""
        url = f"{self.main_api_base}/menus?page=1&type=photo-grafic"
        data = await self._make_request(url)
        if data and "hydra:member" in data and len(data["hydra:member"]) > 0:
            menu = data["hydra:member"][0]
            menu_items = menu.get("menuItems", [])
            
            # Шукаємо Tomorrow (orders=1)
            for item in menu_items:
                if item.get("orders") == 1 or item.get("name") == "Tomorrow":
                    return {
                        "imageUrl": item.get("imageUrl", ""),
                        "rawHtml": item.get("rawHtml", ""),
                        "date": self._extract_date_from_html(item.get("rawHtml", "")),
                        "updateTime": self._extract_update_time(item.get("rawHtml", ""))
                    }
        return {}
    
    def _extract_date_from_html(self, html: str) -> str:
        """Витягти дату з HTML"""
        import re
        if not html:
            return ""
        decoded = html.replace("\\u003C", "<").replace("\\u003E", ">").replace("\\/", "/")
        match = re.search(r'на (\d{2}\.\d{2}\.\d{4})', decoded)
        if match:
            return match.group(1)
        return ""
    
    def _extract_update_time(self, html: str) -> str:
        """Витягти час оновлення з HTML"""
        import re
        if not html:
            return ""
        decoded = html.replace("\\u003C", "<").replace("\\u003E", ">").replace("\\/", "/")
        match = re.search(r'станом на (\d{2}:\d{2} \d{2}\.\d{2}\.\d{4})', decoded)
        if match:
            return match.group(1)
        return ""
    
    def parse_schedule_for_group(self, raw_html: str, cherg_gpv: str) -> Dict[str, Any]:
        """Парсити графік для конкретної групи"""
        import re
        from html.parser import HTMLParser
        
        if not raw_html or not cherg_gpv:
            return {"outages": [], "rawText": "", "hasPower": True}
        
        # Декодувати HTML
        decoded = raw_html.replace("\\u003C", "<").replace("\\u003E", ">").replace("\\/", "/").replace("\\n", "\n")
        
        # Форматувати групу (12 -> 6.2)
        if len(cherg_gpv) == 2:
            formatted_group = f"{cherg_gpv[0]}.{cherg_gpv[1]}"
        else:
            formatted_group = cherg_gpv
        
        # Знайти рядок для цієї групи
        pattern = rf'Група {re.escape(formatted_group)}\.[^<]*'
        match = re.search(pattern, decoded)
        
        if not match:
            return {"outages": [], "rawText": f"Група {formatted_group}: дані не знайдено", "hasPower": True}
        
        group_text = match.group(0)
        outages = []
        
        # Перевірити чи є електроенергія
        if "Електроенергія є" in group_text:
            return {"outages": [], "rawText": group_text, "hasPower": True}
        
        # Парсити інтервали відключень
        time_pattern = r'з (\d{2}:\d{2}) до (\d{2}:\d{2})'
        for time_match in re.finditer(time_pattern, group_text):
            outages.append({
                "start": time_match.group(1),
                "end": time_match.group(2)
            })
        
        return {
            "outages": outages,
            "rawText": group_text,
            "hasPower": len(outages) == 0
        }
    
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
    
    async def get_schedule_image_for_today(self) -> Optional[Dict]:
        """Отримати посилання на зображення графіку на сьогодні"""
        grafics = await self.get_current_grafics()
        if grafics and grafics.get("imageUrl"):
            return {
                "image_url": f"https://api.loe.lviv.ua{grafics['imageUrl']}",
                "date": grafics.get("date", ""),
                "title": grafics.get("title", "")
            }
        return None
    
    async def get_schedule_image_for_tomorrow(self) -> Optional[Dict]:
        """Отримати посилання на зображення графіку на завтра"""
        url = f"{self.main_api_base}/pages?page=1&synonym=power-tomorrow"
        data = await self._make_request(url)
        if data and "hydra:member" in data and len(data["hydra:member"]) > 0:
            page = data["hydra:member"][0]
            if page.get("imageUrl"):
                return {
                    "image_url": f"https://api.loe.lviv.ua{page['imageUrl']}",
                    "date": page.get("date", ""),
                    "title": page.get("title", "")
                }
        return None
    
    async def get_current_power_status(self, cherg_gpv: str) -> Optional[Dict]:
        """Визначити поточний статус електропостачання для групи
        Returns: {
            'is_power_on': bool,
            'next_change_time': str,  # час наступної зміни
            'schedule_intervals': list  # інтервали відключень на сьогодні
        }
        """
        from datetime import datetime
        
        if not cherg_gpv or cherg_gpv == "0":
            return None
        
        # Отримати поточний графік
        grafics = await self.get_current_grafics()
        raw_html = grafics.get("rawHtml", "")
        
        if not raw_html:
            return None
        
        # Парсити графік для групи
        schedule = self.parse_schedule_for_group(raw_html, cherg_gpv)
        outages = schedule.get("outages", [])
        
        # Форматувати групу
        if len(cherg_gpv) == 2:
            group_name = f"{cherg_gpv[0]}.{cherg_gpv[1]}"
        else:
            group_name = cherg_gpv
        
        # Визначити поточний статус
        now = datetime.now()
        current_minutes = now.hour * 60 + now.minute
        
        is_power_on = True
        next_change_time = None
        
        for outage in outages:
            start_h, start_m = map(int, outage["start"].split(":"))
            end_h, end_m = map(int, outage["end"].split(":"))
            start_minutes = start_h * 60 + start_m
            end_minutes = end_h * 60 + end_m
            
            # Якщо зараз відключення
            if start_minutes <= current_minutes < end_minutes:
                is_power_on = False
                next_change_time = outage["end"]
                break
        
        # Якщо світло є, знайти наступне відключення
        if is_power_on:
            for outage in outages:
                start_h, start_m = map(int, outage["start"].split(":"))
                start_minutes = start_h * 60 + start_m
                if start_minutes > current_minutes:
                    next_change_time = outage["start"]
                    break
        
        return {
            "is_power_on": is_power_on,
            "next_change_time": next_change_time,
            "schedule_intervals": outages,
            "group_name": group_name,
            "raw_text": schedule.get("rawText", "")
        }


# Singleton instance
api_service = LoeApiService()
