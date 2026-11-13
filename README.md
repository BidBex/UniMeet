# UniMeet — Find your people. Make plans. Go together.

Built for **UniHack2026** (Timisoara, Romania).

## What UniMeet Is & The Problem It Solves

University students regularly miss concerts, outdoor cinema nights, festivals, theatre performances, and campus meetups simply because nobody in their immediate circle is free or shares the same niche interest. **UniMeet** solves this by connecting people around **concrete shared plans** rather than endless profile browsing.

### Challenge Statement
Design and build a safe, responsive, university-oriented social event discovery and companion-matching platform that takes a student from having an empty evening to attending real local activities with compatible peers or small groups.

## How It Works

1. **Create a profile & pick interests**: Students register with email/username, optionally set their university and city, and choose interests across music, film, gaming, food, sports, and tech.
2. **Discover events, people, groups, or Going Solo posts**: Swipe or filter through upcoming outings, see explainable compatibility scores (`0–100`), join public or private groups, or announce **"Going Solo"** for an upcoming event.
3. **Match & chat in real time**: Reciprocal event likes create mutual matches and open dedicated conversations backed by SQLite persistence and live WebSockets.

## Main Features

- **Tinder-style Swipe Discovery**: Touch/pointer swipe gestures, desktop Like/Skip buttons, and Left/Right Arrow keyboard navigation across Events, People, Groups, and Going Solo feeds.
- **Event Discovery & Outing Hosting**: Search/filter by title, category, city, university, and date; capacity tracking; join/leave; participant lists; and event creation.
- **Going Solo Mode**: Time-limited announcements (`expires_at`) for solo attendees; expired posts automatically drop out of discovery; one-click "Team up" opens a direct chat.
- **Explainable Compatibility Algorithm**: Weighted scoring (`60%` shared interests, `20%` same university, `10%` same city, `10%` overlapping event categories) without using sensitive personal attributes.
- **Groups & University Community**: Create/join public or approval-gated private groups, inspect university activity counts without forcing university affiliation, and coordinate in group chats.
- **Real-Time WebSocket Messaging**: Live chat rooms (`WS /api/ws/chat/{conversation_id}`) with short-lived WS tickets, SQLite persistence, read status, and reconnect recovery.
- **Safety & Moderation**: One-tap blocking (hides blocked users across all discovery, group, solo, and chat views), validated reporting, and moderator-only report triage.

## Technology Stack

- **Backend**: Python 3.10+, FastAPI, SQLAlchemy 2.0, SQLite (`PRAGMA foreign_keys=ON`), Pydantic v2, Argon2 (`argon2-cffi`), PyJWT, Uvicorn WebSockets.
- **Frontend**: Semantic HTML5, CSS3 (centralized CSS variables, responsive grid/flexbox), Vanilla JavaScript ES6+ modules, Fetch API, WebSocket API.
- **Testing**: `pytest` + FastAPI `TestClient` (REST + WebSocket integration tests).

## Architecture & Project Structure

```text
backend/
  app/
    config.py           # Environment-based Pydantic settings
    database.py         # SQLite engine, FK pragma, SessionLocal, Base
    main.py             # FastAPI app, CORS, lifespan DB init, static mount
    seed.py             # Explicit CLI demo seeder (Timișoara + RO universities)
    models/             # 16+ relational SQLAlchemy ORM models
    schemas/            # Pydantic v2 request/response contracts
    security/           # Argon2 password hashing, JWT, HttpOnly + CSRF, WS tickets
    services/           # Compatibility algorithm, serializers, WS room manager
    routers/            # auth, users, interests, events, matches, groups, solo, messages, community, safety
  tests/                # pytest suite covering auth, events, and Journeys A–E
  requirements.txt
  .env.example
  README.md

frontend/
  index.html            # Landing page
  login.html            # Login page
  register.html         # Registration page
  discover.html         # Swipe discovery deck (Events / People / Groups / Going Solo)
  events.html           # Event search, filters & details modal
  create-event.html     # Create outing & post Going Solo
  matches.html          # Mutual matches
  messages.html         # Real-time WebSocket chat workspace
  groups.html           # Groups, Going Solo feed & University Community
  profile.html          # Profile editor, interests, upcoming events & blocked users
  css/                  # main.css, components.css, auth.css, discover.css, responsive.css
  js/                   # config.js, api.js, auth.js, navigation.js, discover.js, events.js, matches.js, messages.js, groups.js, profile.js, utils.js
  assets/               # Generated event photography & UniMeet SVG logo
```

## Installation & Running Locally

### 1. Backend Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

### 2. Seed Demo Data (Development Only)

```bash
cd backend
.venv/bin/python -m app.seed
```

### 3. Start the Application

From `backend/`:

```bash
.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

FastAPI serves both the REST/WebSocket API and the `frontend/` static files on `http://localhost:8000`:
- **App Landing Page**: `http://localhost:8000/index.html`
- **API Docs (Swagger UI)**: `http://localhost:8000/docs`
- **Health Check**: `http://localhost:8000/api/health`

*(Optional)* You can also serve `frontend/` separately on `http://localhost:5500` via `python3 -m http.server 5500` inside `frontend/` — `frontend/js/config.js` automatically targets `http://localhost:8000/api` and CORS allows `localhost:5500` / `localhost:3000`.

## Environment Variables (`backend/.env.example`)

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | SQLite database connection URI | `sqlite:///./unimeet.db` |
| `JWT_SECRET_KEY` | HS256 signing secret (change in production) | dev placeholder |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | JWT/cookie lifetime in minutes | `60` |
| `CORS_ORIGINS` | Allowed frontend origins | `localhost:3000,5500` |
| `ENVIRONMENT` | `development`, `test`, or `production` | `development` |

## Demo Accounts

All 12 seeded demo users use password `DemoUser123!`:
- `elena.demo@unimeet.edu` (Politehnica University of Timisoara — moderator demo account)
- `andrei.demo@unimeet.edu` (West University of Timisoara)
- `mara.demo@unimeet.edu` (West University of Timisoara)
- `lucas.demo@unimeet.edu` (Erasmus student, Timisoara)

## Testing

```bash
PYTHONPATH=backend backend/.venv/bin/pytest backend/tests -v
```

## Known Limitations & Future Improvements

- **Email / University ID Verification**: Accounts are accurately labeled as email accounts (`is_verified=False`); university `.edu` domain verification emails and student ID checks are planned for post-hackathon release.
- **Image Uploads**: Profile pictures currently accept optional URLs with automatic initials fallbacks; multipart file storage (S3/local uploads) can be added next.
- **Moderator UI**: Moderator report review endpoints (`GET /api/safety/reports`, `PUT /api/safety/reports/{id}`) are implemented and tested on the backend; a dedicated frontend moderation dashboard is a future enhancement.

## Team Contributions

- **Developer 1**: FastAPI architecture, SQLite + 16 SQLAlchemy models, Argon2/JWT/CSRF authentication, user profiles, events API, demo seeding, and backend tests.
- **Developer 2**: Design system, responsive landing page, auth forms, dashboard shell, swipe discovery UI, event browser, profile editor, and centralized API client.
- **Developer 3**: Individual matching, public/private groups, Going Solo expiration workflow, explainable compatibility scoring, real-time WebSocket chat, university community, safety/moderation, end-to-end integration, and documentation.
