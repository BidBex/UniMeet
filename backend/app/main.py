from contextlib import asynccontextmanager

from fastapi import FastAPI, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.database import check_db_connection, init_db
from app.routers import auth, events, interests, users
from app.schemas import HealthResponse

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Initialize database metadata on application startup."""
    init_db()
    yield


def create_app() -> FastAPI:
    application = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        description="UniMeet backend API for university social event discovery and matching.",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )

    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @application.get(
        f"{settings.API_PREFIX}/health",
        response_model=HealthResponse,
        tags=["Health"],
        summary="Application health check",
    )
    def health_check():
        db_ok = check_db_connection()
        payload = HealthResponse(
            status="ok" if db_ok else "degraded",
            app=settings.APP_NAME,
            version=settings.APP_VERSION,
            environment=settings.ENVIRONMENT,
            database="connected" if db_ok else "unavailable",
        )
        if not db_ok:
            return JSONResponse(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                content=payload.model_dump(),
            )
        return payload

    application.include_router(auth.router, prefix=settings.API_PREFIX)
    application.include_router(users.router, prefix=settings.API_PREFIX)
    application.include_router(events.router, prefix=settings.API_PREFIX)
    application.include_router(interests.router, prefix=settings.API_PREFIX)

    return application


app = create_app()
