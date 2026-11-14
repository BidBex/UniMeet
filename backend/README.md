# UniMeet Backend (FastAPI + SQLAlchemy + SQLite)

Backend service for **UniMeet** (UniHack2026).

## Installation & Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

## Database & Demo Seeding

SQLite tables are initialized automatically on FastAPI startup via `init_db()` (with `PRAGMA foreign_keys=ON`).

To populate sample Timisoara + Romanian university demo data (never runs automatically when `ENVIRONMENT=production`):

```bash
cd backend
.venv/bin/python -m app.seed
```

Demo account credentials (all seeded demo users share the same password):
- Email: `elena.demo@unimeet.edu` (moderator demo account) / `andrei.demo@unimeet.edu` / `mara.demo@unimeet.edu`
- Password: `DemoUser123!`

## Running the Backend

From `backend/`:

```bash
.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- Application + Frontend: `http://localhost:8000`
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`
- Health Check: `GET http://localhost:8000/api/health`

## Running Tests

From repository root:

```bash
PYTHONPATH=backend backend/.venv/bin/pytest backend/tests -v
```

## Authentication & CSRF Strategy

- Passwords are hashed using **Argon2** (`argon2-cffi`).
- `POST /api/auth/register` and `POST /api/auth/login` issue a signed HS256 JWT stored in an `HttpOnly`, `SameSite=Lax` cookie (`unimeet_access_token`) alongside a readable double-submit CSRF cookie (`unimeet_csrf_token`).
- Browser mutating requests (`POST`, `PUT`, `DELETE`) authenticated via cookies send `X-CSRF-Token` matching `unimeet_csrf_token`.
- Programmatic API clients may also pass `Authorization: Bearer <access_token>`.
- WebSocket connections (`/api/ws/chat/{conversation_id}`) authenticate via the `HttpOnly` cookie or a short-lived single-use connection ticket obtained from `POST /api/messages/ws-ticket` (30s TTL) — long-lived JWTs are never placed in URL query strings.

## API Contract Summary

- **Health**: `GET /api/health`
- **Auth**: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- **Users & Interests**: `GET /api/users/me`, `PUT /api/users/me`, `GET /api/users/discover`, `GET /api/users/interests`, `PUT /api/users/interests`, `GET /api/users/{user_id}`, `GET /api/users/{user_id}/compatibility`, `GET /api/interests`
- **Events**: `GET /api/events`, `GET /api/events/{id}`, `POST /api/events`, `PUT /api/events/{id}`, `DELETE /api/events/{id}`, `POST /api/events/{id}/join`, `DELETE /api/events/{id}/leave`, `POST /api/events/{id}/like`, `GET /api/events/{id}/participants`
- **Matching**: `POST /api/matches/like`, `GET /api/matches`, `GET /api/matches/{id}`, `DELETE /api/matches/{id}`
- **Groups**: `GET /api/groups`, `GET /api/groups/{id}`, `POST /api/groups`, `PUT /api/groups/{id}`, `DELETE /api/groups/{id}`, `POST /api/groups/{id}/join`, `DELETE /api/groups/{id}/leave`, `GET /api/groups/{id}/members`, `POST /api/groups/{id}/members/{uid}/approve`, `POST /api/groups/{id}/invite`
- **Going Solo**: `POST /api/solo`, `GET /api/solo`, `GET /api/solo/{id}`, `DELETE /api/solo/{id}`, `POST /api/solo/{id}/interest`
- **Messaging**: `POST /api/messages/ws-ticket`, `GET /api/messages/conversations`, `GET /api/messages/conversations/{id}`, `POST /api/messages/conversations/{id}/messages`, `PUT /api/messages/{id}/read`, `WS /api/ws/chat/{conversation_id}`
- **Community**: `GET /api/community`, `GET /api/community/universities`, `GET /api/community/events`
- **Safety**: `POST /api/safety/block/{user_id}`, `DELETE /api/safety/block/{user_id}`, `GET /api/safety/blocked`, `POST /api/safety/report`, `GET /api/safety/reports`, `PUT /api/safety/reports/{id}`
