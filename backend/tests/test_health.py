from fastapi.testclient import TestClient
from sqlalchemy import text

from app.database import engine
from app.main import app


def test_health_endpoint():
    with TestClient(app) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["app"] == "UniMeet API"
    assert data["version"] == "0.1.0"
    assert data["database"] == "connected"


def test_openapi_docs_available():
    with TestClient(app) as client:
        docs_res = client.get("/docs")
        openapi_res = client.get("/openapi.json")

    assert docs_res.status_code == 200
    assert openapi_res.status_code == 200
    schema = openapi_res.json()
    assert "/api/health" in schema["paths"]


def test_cors_headers_for_allowed_origin():
    with TestClient(app) as client:
        response = client.options(
            "/api/health",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET",
            },
        )

    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:3000"


def test_sqlite_foreign_keys_enabled():
    with engine.connect() as conn:
        result = conn.execute(text("PRAGMA foreign_keys")).scalar()
    assert result == 1
