import os
from dotenv import load_dotenv

load_dotenv()

# Telegram Bot
BOT_TOKEN = os.getenv("BOT_TOKEN")

# Web App URL
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://loenergo.web.app")

# LOE API
LOE_API_BASE = os.getenv("LOE_API_BASE", "https://power-api.loe.lviv.ua/api")
LOE_MAIN_API_BASE = os.getenv("LOE_MAIN_API_BASE", "https://api.loe.lviv.ua/api")

# Firebase Realtime Database URL
# ⚠️ ОБОВ'ЯЗКОВО ВСТАНОВИТИ В .env!
# Формат: https://PROJECT-ID-default-rtdb.REGION.firebasedatabase.app
FIREBASE_DATABASE_URL = os.getenv("FIREBASE_DATABASE_URL")

# Notification settings
CHECK_INTERVAL = int(os.getenv("CHECK_INTERVAL", 5))  # minutes

# Database (local SQLite as fallback)
DATABASE_PATH = os.path.join(os.path.dirname(__file__), "data", "users.db")

# Logging level: DEBUG, INFO, WARNING, ERROR
# На продакшені встановити WARNING або ERROR для економії квоти
LOG_LEVEL = os.getenv("LOG_LEVEL", "WARNING")
DEBUG_MODE = os.getenv("DEBUG_MODE", "false").lower() == "true"
