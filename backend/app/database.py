from typing import Generator

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings

settings = get_settings()

is_sqlite = settings.DATABASE_URL.startswith("sqlite")
connect_args = {"check_same_thread": False} if is_sqlite else {}

engine = create_engine(
    settings.DATABASE_URL,
    connect_args=connect_args,
    echo=settings.DEBUG and settings.ENVIRONMENT == "development",
    future=True,
)

if is_sqlite:

    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    class_=Session,
)


class Base(DeclarativeBase):
    """Declarative base class for all SQLAlchemy ORM models."""


def get_db() -> Generator[Session, None, None]:
    """Yield a scoped SQLAlchemy session per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Import ORM models and create database tables if they do not exist."""
    import app.models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    if is_sqlite:
        with engine.begin() as conn:
            cols = {row[1] for row in conn.execute(text("PRAGMA table_info(users)"))}
            if cols and "demo_key" not in cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN demo_key VARCHAR(50)"))


def check_db_connection() -> bool:
    """Verify database connectivity with a lightweight query."""
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
