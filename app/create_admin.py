"""Promote an existing account to administrator: python -m app.create_admin user@example.com"""
import sys
from sqlalchemy import select
from .database import SessionLocal
from .models import User


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python -m app.create_admin user@example.com")
    email = sys.argv[1].strip().lower()
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        if not user:
            raise SystemExit("No account found. Register the account first, then run this command.")
        user.role = "admin"
        db.commit()
        print(f"Administrator role enabled for {email}.")


if __name__ == "__main__":
    main()
