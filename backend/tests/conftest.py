import os
from pathlib import Path
import tempfile

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

# Configure test DB before importing app settings/database
TEST_DB_FILE = os.path.join(tempfile.gettempdir(), "unimeet_test.db")
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB_FILE}"
os.environ["ENVIRONMENT"] = "test"

from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.interest import Interest  # noqa: E402

test_engine = create_engine(
    f"sqlite:///{TEST_DB_FILE}",
    connect_args={"check_same_thread": False},
    future=True,
)


@event.listens_for(test_engine, "connect")
def _enable_sqlite_fk(dbapi_connection, _record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(scope="session", autouse=True)
def cleanup_test_db_file():
    yield
    test_engine.dispose()
    if Path(TEST_DB_FILE).exists():
        try:
            os.remove(TEST_DB_FILE)
        except OSError:
            pass


@pytest.fixture(autouse=True)
def clean_database():
    Base.metadata.drop_all(bind=test_engine)
    Base.metadata.create_all(bind=test_engine)

    # Seed baseline interests for tests
    db = TestingSessionLocal()
    try:
        db.add_all(
            [
                Interest(name="Indie Rock", category="Music"),
                Interest(name="Festival Hopping", category="Music"),
                Interest(name="Indie Cinema", category="Film & Arts"),
                Interest(name="Board Games", category="Gaming & Social"),
                Interest(name="Specialty Coffee", category="Food & Lifestyle"),
            ]
        )
        db.commit()
    finally:
        db.close()

    yield

    Base.metadata.drop_all(bind=test_engine)


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def db_session():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
