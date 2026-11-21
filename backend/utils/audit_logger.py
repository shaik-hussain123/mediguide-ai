"""Audit logging service for MediGuide AI."""

import logging
from datetime import datetime
from typing import Optional, Any
from motor.motor_asyncio import AsyncIOMotorDatabase

logger = logging.getLogger(__name__)

class AuditLogger:
    def __init__(self, db: Optional[AsyncIOMotorDatabase] = None):
        self.db = db
        self.collection_name = "audit_logs"

    async def log(self, action: str, user: str = "anonymous", resource: str = "", details: Optional[Any] = None):
        """Log an action to the database and system logger."""
        timestamp = datetime.utcnow().isoformat()

        audit_entry = {
            "action": action,
            "user": user,
            "resource": resource,
            "details": details,
            "timestamp": timestamp,
        }

        # Log to system logger
        logger.info(f"AUDIT: {action} | User: {user} | Resource: {resource}")

        # Log to MongoDB if available
        if self.db is not None:
            try:
                await self.db[self.collection_name].insert_one(audit_entry)
            except Exception as e:
                logger.error(f"Failed to write audit log to database: {e}")

# Global instance
audit_logger = AuditLogger()

def setup_audit_logger(db: AsyncIOMotorDatabase):
    """Initialize the global audit logger with a database connection."""
    global audit_logger
    audit_logger.db = db
