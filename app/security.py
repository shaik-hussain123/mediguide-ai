from datetime import datetime, timedelta, timezone
from uuid import uuid4
import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordBearer
from pwdlib import PasswordHash
from sqlalchemy.orm import Session
from .config import settings
from .database import get_db
from .models import TokenRevocation, User

password_hash = PasswordHash.recommended()
oauth2 = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, encoded: str) -> bool:
    return password_hash.verify(password, encoded)


def revoke_token(token: str, db: Session) -> None:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
        jti = payload.get("jti")
        expiry = datetime.fromtimestamp(payload["exp"], timezone.utc)
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        return
    if jti and not db.get(TokenRevocation, jti):
        db.add(TokenRevocation(jti=jti, expires_at=expiry))


def create_token(user: User) -> str:
    expires = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_minutes)
    return jwt.encode({"sub": str(user.id), "exp": expires, "jti": str(uuid4())}, settings.secret_key, algorithm="HS256")


def current_user(request: Request, token: str | None = Depends(oauth2), db: Session = Depends(get_db)) -> User:
    token = token or request.cookies.get("mediguide_access")
    if not token:
        raise HTTPException(status_code=401, detail="Please sign in again.", headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
        user_id = int(payload["sub"])
        jti = payload.get("jti")
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(status_code=401, detail="Please sign in again.", headers={"WWW-Authenticate": "Bearer"})
    if jti and db.get(TokenRevocation, jti):
        raise HTTPException(status_code=401, detail="Please sign in again.", headers={"WWW-Authenticate": "Bearer"})
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Account not found.")
    return user


def admin_user(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Administrator access required.")
    return user
