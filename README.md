<p align="center">
  <img src="frontend/public/logo.svg" alt="porchsongs" width="120" />
</p>

<h1 align="center">porchsongs</h1>

<p align="center">
  <a href="https://porchsongs.ai"><img alt="Try it live" src="https://img.shields.io/badge/try_it_live-porchsongs.ai-ff6b35?style=for-the-badge" /></a>
</p>

<p align="center">
  <img alt="Python" src="https://img.shields.io/badge/python-3.11+-blue?logo=python&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/react-19-61dafb?logo=react&logoColor=white" />
  <img alt="FastAPI" src="https://img.shields.io/badge/fastapi-0.115-009688?logo=fastapi&logoColor=white" />
  <a href="https://any-llm.ai/"><img alt="any-llm" src="https://img.shields.io/badge/LLM-gateway-c06830" /></a>
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green" />
</p>

<p align="center">
  Keep your chord charts in one place and play them from any screen. Tuner, hands-free
  scrolling, and a clean performance view, with optional AI to tidy up a chart or rewrite the words.<br />
  Powered by <a href="https://any-llm.ai/">any-llm</a> -- routed through a single LLM gateway.
</p>

---

<p align="center">
  <img src="assets/porchsongs-demo.gif" alt="PorchSongs demo" width="720" />
</p>

porchsongs preserves meter, rhyme scheme, chord alignment, and emotional meaning -- it only swaps out the imagery that doesn't fit.

## Try It Live

**[porchsongs.ai](https://porchsongs.ai)** is the hosted version of porchsongs. Sign in with Google, pick a plan, and start rewriting. No setup, no API keys to manage.

If you prefer to self-host or want to point porchsongs at your own LLM gateway, follow the [Quick Start](#quick-start) below.

## How It Works

1. **Paste your lyrics** -- with or without chords, any format works
2. **Chat to workshop the lyrics** -- tell the AI what to change ("swap the truck for my bike," "make verse 2 about coding") and iterate in a live conversation
3. **Play and enjoy** -- chords are automatically realigned above your new lyrics

## Quick Start

```bash
pip install uv
uv sync
cd frontend && npm install && npm run build && cd ..
cd backend
LLM_API_BASE=https://your-gateway/v1 LLM_API_KEY=your-key \
  uv run uvicorn app.main:app --reload
```

Open [http://localhost:8000](http://localhost:8000). porchsongs routes all AI traffic
through a single LLM gateway; set `LLM_API_BASE` and `LLM_API_KEY` (see the
[environment variables](#environment-variables) below), then pick a model in Settings.

### Run with no AI

The AI is optional, and self-hosting without it is a supported setup:

```bash
cd backend && uv run uvicorn app.main:app --reload
```

Importing charts, storing tab PDFs, the library, the performance view, the tuner,
hands-free scrolling, the chord dictionary, and PDF export all work with no gateway
configured. Only three things need one: tidying up a chart's formatting, rewriting
lyrics, and suggesting a folder for a chart. Those actions disable themselves and say why. Folders themselves
are entirely manual and always work; the AI suggestion is one opt-in tap on one chart.

This used to be impossible. Saving a chart went through the LLM parse endpoint and the
save button was gated on having a model selected, so an instance with no gateway could
not store a song at all.

### Store the tabs you already have

Not everything in a songbook is a chord chart. Tab you have collected as PDFs can be
stored alongside your charts and played from the same performance view: page forward
and back with the on-screen controls, the arrow keys, or a bluetooth page turner, and
zoom in to read the fret numbers from a stand.

Stored tabs are kept as files, not parsed. Nothing rewrites them, and no gateway is
involved. Any one of them can be kept on the device for offline play, which is a
per-tab choice rather than an automatic sync: a chart is a few kilobytes of text, but a
tab collection is hundreds of megabytes and syncing all of it is not a favour. A kept
tab opens with no network request at all.

By default, porchsongs runs in **zero-config dev mode** -- no login required, a local user is auto-created. See [Authentication](#authentication) below for production setups.

For frontend development with hot reload:

```bash
# Terminal 1: backend
cd backend && uv run uvicorn app.main:app --reload

# Terminal 2: frontend (proxies /api to backend)
cd frontend && npm run dev
```

## Docker

```bash
cp .env.example .env
# Edit .env -- set JWT_SECRET to a long random string
docker compose up --build
```

This starts PostgreSQL + runs database migrations + serves the app on port 8000.

## Authentication

porchsongs supports three auth modes, controlled by environment variables:

### Zero-config dev mode (default)

No env vars needed. The app is open to anyone who can reach it. A local user is auto-created.

### Single-user password protection

Set `APP_SECRET` to gate the app behind a password:

```bash
APP_SECRET=your-secret-password
JWT_SECRET=a-long-random-string-at-least-32-chars
```

You can also use a bcrypt hash for `APP_SECRET`:

```bash
# Generate a hash
python3 -c "import bcrypt; print(bcrypt.hashpw(b'mypassword', bcrypt.gensalt()).decode())"

# Use it in .env
APP_SECRET='$2b$12$...'
```

### Premium plugin

For Google OAuth and other premium features, see the [porchsongs-premium](https://github.com/Brake-Labs/porchsongs-premium) repo.

```bash
PREMIUM_PLUGIN=porchsongs_premium.plugin
```

## Database

porchsongs uses **PostgreSQL** everywhere (production, development, and testing).

```bash
# Production (set in .env or environment)
DATABASE_URL=postgresql://porchsongs:porchsongs@localhost:5432/porchsongs

# Local dev / testing
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/porchsongs_test

# Quick PostgreSQL setup via Docker
docker run --name porchsongs-pg -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=porchsongs_test -p 5432:5432 -d postgres:16

# Apply migrations
uv run alembic upgrade head
```

Docker Compose includes a PostgreSQL service and runs migrations automatically on startup.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://...localhost.../porchsongs` | Database connection string |
| `JWT_SECRET` | `change-me-in-production` | Secret for signing JWT tokens (use 32+ chars) |
| `AUTH_BACKEND` | `app_secret` | Auth mode: `app_secret` (premium plugins can add others) |
| `APP_SECRET` | *(none)* | Password gate (app_secret mode). Supports plaintext or bcrypt hash |
| `CORS_ORIGINS` | `*` | Allowed CORS origins (comma-separated) |
| `JWT_EXPIRY_MINUTES` | `15` | Access token lifetime |
| `REFRESH_TOKEN_DAYS` | `30` | Refresh token lifetime |
| `PREMIUM_PLUGIN` | *(none)* | Module path for premium auth backend |
| `LLM_API_BASE` | *(none)* | LLM gateway base URL (OpenAI-compatible, e.g. `https://your-gateway/v1`). Required for AI features |
| `LLM_API_KEY` | *(none)* | LLM gateway API key (read server-side, never sent to the browser) |
| `LLM_PROVIDER` | `otari` | any-llm provider name for the gateway |

See `.env.example` for the full list.

## Testing

```bash
# Backend tests (118 tests)
uv run pytest
uv run pytest -v                    # verbose
uv run pytest tests/test_auth.py    # auth tests only

# Frontend tests (39 tests)
cd frontend && npx vitest run

# Lint & type check
uv run ruff check backend/
uv run ruff format --check backend/
cd frontend && npx eslint src/
cd frontend && npm run typecheck
```

## LLM gateway -- Powered by any-llm

porchsongs routes all AI traffic through a single **LLM gateway** using **[any-llm](https://any-llm.ai/)**. Point `LLM_API_BASE` / `LLM_API_KEY` at any OpenAI-compatible gateway (an [Otari](https://any-llm.ai/) deployment by default) and pick a model in Settings; the model catalog is discovered from the gateway. Keys live only on the server and are never sent from the browser.

| | |
|---|---|
| **Website** | [any-llm.ai](https://any-llm.ai/) |
| **GitHub** | [mozilla-ai/any-llm](https://github.com/mozilla-ai/any-llm) |

Routing everything through one gateway gives porchsongs:
- **One place to manage credentials, models, and spend** -- no per-provider keys in the app
- **Model discovery** -- the Settings model picker is populated from the gateway's catalog
- **Consistent interface** -- streaming, async, and reasoning work the same regardless of the model behind the gateway

Bring your own API key, configure it in Settings, and start rewriting.
