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


DEFAULT_INTERESTS = [
    ("Indie Rock", "Music"),
    ("Electronic & Techno", "Music"),
    ("Jazz & Acoustic", "Music"),
    ("Festival Hopping", "Music"),
    ("Indie Cinema", "Film & Arts"),
    ("Contemporary Theatre", "Film & Arts"),
    ("Photography", "Film & Arts"),
    ("Board Games", "Gaming & Social"),
    ("Esports & LAN", "Gaming & Social"),
    ("Specialty Coffee", "Food & Lifestyle"),
    ("Street Food", "Food & Lifestyle"),
    ("Hiking & Cycling", "Sports & Outdoors"),
    ("Running Club", "Sports & Outdoors"),
    ("City Exploring", "Travel"),
    ("Hackathons & Tech", "Academic & Tech"),
    ("Language Exchange", "Academic & Tech"),
]


def init_db() -> None:
    """Import ORM models and create database tables if they do not exist."""
    import app.models  # noqa: F401
    from app.models.interest import Interest

    Base.metadata.create_all(bind=engine)
    if is_sqlite:
        with engine.begin() as conn:
            cols = {row[1] for row in conn.execute(text("PRAGMA table_info(users)"))}
            if cols and "demo_key" not in cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN demo_key VARCHAR(50)"))
            msg_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(messages)"))}
            if msg_cols and "is_unsent" not in msg_cols:
                conn.execute(text("ALTER TABLE messages ADD COLUMN is_unsent BOOLEAN NOT NULL DEFAULT 0"))

    if settings.ENVIRONMENT.lower() != "test":
        db = SessionLocal()
        try:
            if db.query(Interest).count() == 0:
                db.add_all([Interest(name=name, category=category) for name, category in DEFAULT_INTERESTS])
                db.commit()
        finally:
            db.close()


def check_db_connection() -> bool:
    """Verify database connectivity with a lightweight query."""
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
