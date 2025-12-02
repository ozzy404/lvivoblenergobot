"""
Львівобленерго Telegram Bot
Main entry point
"""
import asyncio
import logging
from telegram.ext import (
    Application,
    CommandHandler,
    CallbackQueryHandler,
    MessageHandler,
    filters
)

from config import BOT_TOKEN
from database import db
from handlers import (
    start_command,
    callback_handler,
    schedule_command,
    notifications_command,
    help_command,
    webapp_data_handler
)
from notifications import NotificationService
from api_service import api_service

# Configure logging
logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO
)
logger = logging.getLogger(__name__)


async def post_init(application: Application):
    """Post initialization hook"""
    # Initialize database
    await db.init_db()
    logger.info("Database initialized")
    
    # Start notification service
    from notifications import notification_service
    import notifications
    notifications.notification_service = NotificationService(application.bot)
    
    # Run notification service in background
    asyncio.create_task(notifications.notification_service.start())
    logger.info("Notification service started")


async def shutdown(application: Application):
    """Shutdown hook"""
    from notifications import notification_service
    if notification_service:
        await notification_service.stop()
    
    await api_service.close()
    logger.info("Bot shutdown complete")


def main():
    """Main function to run the bot"""
    if not BOT_TOKEN:
        logger.error("BOT_TOKEN is not set! Please set it in .env file")
        return
    
    # Build application
    application = (
        Application.builder()
        .token(BOT_TOKEN)
        .post_init(post_init)
        .post_shutdown(shutdown)
        .build()
    )
    
    # Add handlers
    application.add_handler(CommandHandler("start", start_command))
    application.add_handler(CommandHandler("schedule", schedule_command))
    application.add_handler(CommandHandler("notifications", notifications_command))
    application.add_handler(CommandHandler("help", help_command))
    
    # Callback handler for inline buttons
    application.add_handler(CallbackQueryHandler(callback_handler))
    
    # Web App data handler
    application.add_handler(
        MessageHandler(filters.StatusUpdate.WEB_APP_DATA, webapp_data_handler)
    )
    
    # Run bot
    logger.info("Starting bot...")
    application.run_polling(allowed_updates=["message", "callback_query", "web_app_data"])


if __name__ == "__main__":
    main()
