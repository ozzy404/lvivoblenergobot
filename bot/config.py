import os
from dotenv import load_dotenv

load_dotenv()

# Telegram Bot
BOT_TOKEN = os.getenv("BOT_TOKEN")

# Web App URL
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://your-project.web.app")

# LOE API
LOE_API_BASE = os.getenv("LOE_API_BASE", "https://power-api.loe.lviv.ua/api")
LOE_MAIN_API_BASE = os.getenv("LOE_MAIN_API_BASE", "https://api.loe.lviv.ua/api")

# Notification settings
CHECK_INTERVAL = int(os.getenv("CHECK_INTERVAL", 5))  # minutes

# Database
DATABASE_PATH = os.path.join(os.path.dirname(__file__), "data", "users.db")
