# Forge -- AI Web Builder

> Describe it. Forge builds it.

Forge is an AI-powered web builder that converts natural-language descriptions into working single-page web applications. A multi-agent pipeline plans the architecture, generates production-ready HTML/CSS/JS, and streams the result to a live preview -- all in real time. Built with a React 19 frontend, a Python FastAPI backend, and cost-optimized model routing across 8 open-source AI models.

---

## Live Demo

| Service | URL | Status |
|---------|-----|--------|
| Frontend | [ai-builder.adarshweb.in](https://ai-builder.adarshweb.in) | Live |
| Backend API | [api.ai-builder.adarshweb.in/api/health](https://api.ai-builder.adarshweb.in/api/health) | Live |

---

## What It Does

- **Natural language to working app** -- describe an app in plain English, get a complete, functional single-page web application
- **Real-time streaming** -- code is streamed token-by-token via Server-Sent Events as the AI generates it, with keepalive heartbeats to prevent proxy timeouts
- **Live preview** -- generated apps render instantly in a sandboxed iframe that updates as code arrives
- **Chat-based iteration** -- refine generated apps through follow-up prompts ("add dark mode", "make the buttons blue") without starting over
- **Multi-model selection** -- choose from 8 cost-tiered AI models, from $0.14/M to $4.00/M tokens, balancing speed, quality, and cost
- **Project save/load** -- persist generated apps to the database, resume editing from the dashboard, full CRUD with pagination
- **GitHub authentication** -- sign in with GitHub, per-user rate limiting, project ownership scoping
- **ZIP export** -- download generated apps as portable archives

---

## Screenshots

<!-- Replace placeholders with actual screenshots/GIFs -->

| Landing Page | Builder (Empty) | Generating | Live Preview |
|-------------|----------------|------------|--------------|
| ![Landing](./screenshots/landing.png) | ![Builder Empty](./screenshots/builder-empty.png) | ![Generating](./screenshots/generating.png) | ![Preview](./screenshots/preview.png) |

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Frontend** | React 19 + Vite + TypeScript + shadcn/ui + TailwindCSS v4 + framer-motion + GSAP | Strong type safety, modern UI primitives, smooth animations |
| **Backend** | Python 3.12 + FastAPI + Uvicorn | Async-native, high throughput, standard for Python API servers |
| **AI Gateway** | OpenCode Go API (dual-protocol: OpenAI + Anthropic) | 8 open-source models through one unified interface, ~$0.008 per generation |
| **Auth** | GitHub OAuth + JWT (httpOnly cookies) | Frictionless sign-in, stateless session verification |
| **Database** | SQLite + aiosqlite + SQLAlchemy 2.0 async | Zero-config, serverless-friendly, sufficient for portfolio scale |
| **Frontend Deploy** | Vercel | Zero-config Vite + React hosting with edge CDN |
| **Backend Deploy** | Oracle Cloud ARM VPS (Docker + Nginx + Let's Encrypt) | No request timeouts for long AI streams, 12GB RAM |
| **DNS** | Hostinger + Cloudflare | Domain management with DDoS protection and SSL |

---

## Architecture

```
                          ┌─────────────────────────────┐
                          │      React 19 Frontend      │
                          │   (Vercel + TailwindCSS v4)  │
                          └─────────────┬───────────────┘
                                        │
                              POST /api/generate
                              { prompt, model }
                                        │
                          ┌─────────────v───────────────┐
                          │     FastAPI (Python 3.12)    │
                          │    GitHub OAuth + JWT auth   │
                          │   Per-user rate limiting     │
                          └─────────────┬───────────────┘
                                        │
                    ┌───────────────────┼───────────────────┐
                    │                   │                   │
          ┌─────────v─────────┐ ┌───────v───────┐ ┌───────v───────┐
          │   1. Planner      │ │  2. Extract   │ │   3. Coder    │
          │   (DeepSeek Flash)│ │    title      │ │ (user choice) │
          │   prompt -> plan  │ │  -> SSE event │ │ plan -> code  │
          └─────────┬─────────┘ └───────────────┘ └───────┬───────┘
                    │                                     │
                    │       SSE: {type:"code"} x N        │
                    └─────────────────┬───────────────────┘
                                      │
                          ┌───────────v───────────┐
                          │  Dual-Protocol Client  │
                          │  auto-routes by model  │
                          └───────────┬───────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    │                 │                 │
          ┌─────────v─────────┐             ┌─────────v─────────┐
          │ OpenAI /chat/     │             │ Anthropic /messages│
          │ completions       │             │                   │
          │ (DeepSeek, Kimi,  │             │ (MiniMax, Qwen,   │
          │  MiMo, GLM)       │             │  Qwen3.6)         │
          └───────────────────┘             └───────────────────┘
```

The system uses a multi-agent pipeline designed for cost-efficiency and real-time UX. The planner runs on the cheapest model (DeepSeek V4 Flash at $0.14/M tokens) to produce a structured build plan. The coder runs on the user's chosen model and streams HTML tokens back over SSE. A dual-protocol API client auto-routes between OpenAI and Anthropic message formats based on model ID, so all 8 models work through one unified interface. SSE keepalive heartbeats defeat Cloudflare and Nginx idle-timeout proxies during long generations (30s-2min).

---

## Key Engineering Decisions

- **Multi-agent pipeline with cost-aware model routing** -- The planner uses the cheapest available model (DeepSeek V4 Flash, $0.14/M input), while the coder runs on the user's choice. This keeps cost per generation at approximately $0.008, meaning a $20 API balance produces roughly 2,500 apps.

- **Dual-protocol API client** -- A single `OpenCodeClient` class auto-routes between OpenAI `/chat/completions` and Anthropic `/messages` endpoints based on model ID. The same Bearer token authenticates both protocols. No model-specific clients, no branching in application code.

- **SSE streaming with keepalive heartbeats** -- Server-Sent Events carry code tokens from backend to frontend in real time. An SSE comment (`: keepalive`) is injected every 15 seconds during slow streams to prevent Cloudflare's 100-second idle proxy timeout from killing the connection.

- **GitHub OAuth + JWT + per-user rate limiting** -- Stateless authentication via httpOnly JWT cookies. Per-user rate limiting (slowapi) prevents API budget abuse. Project ownership scoping ensures users can only access their own saved projects.

- **Sandboxed iframe preview** -- Generated apps run in a `<iframe sandbox="allow-scripts allow-same-origin">` so they execute JavaScript and access localStorage but cannot navigate the parent page or access cookies from the main domain.

- **192 tests across the stack** -- 64 backend pytest tests covering API contracts, SSE parsing, auth flows, rate limiting, and project ownership. 128 frontend vitest tests covering React components, hooks, SSE streaming, and utility functions.

---

## Features in Detail

### AI Generation

Describe any web application in natural language and Forge produces a complete, self-contained single-page app. The multi-agent pipeline first plans the architecture (component structure, styling approach, interactions), then generates the full HTML/CSS/JS in a single file. No boilerplate, no templates -- every generation is unique to the prompt.

### Real-Time Streaming

Code doesn't appear all at once. Each token is streamed to the frontend via Server-Sent Events as the AI generates it, so users see progress within seconds. The streaming includes automatic keepalive heartbeats that prevent reverse proxies (Cloudflare, Nginx) from dropping idle connections during longer generations.

### Live Preview

Generated code renders immediately in a sandboxed iframe. The preview updates as new code chunks arrive, giving users a real-time view of their app taking shape. The sandbox isolates generated code from the main application while still allowing JavaScript execution and localStorage access.

### Chat Iteration

Not satisfied with the result? Describe what you want changed -- "add a dark mode toggle", "make the sidebar collapsible", "rename the title to Task Board" -- and Forge applies the modification. The iteration endpoint sends the full current code plus your instruction to the AI, which returns the complete updated file. No diffs, no partial patches -- atomic replacements every time.

### Multi-Model Selection

Choose from 8 AI models across four cost tiers, from $0.14/M to $4.00/M tokens. The model picker shows pricing, context window, and a recommended badge so you can balance cost against quality. The default model (DeepSeek V4 Flash) costs approximately $0.008 per full generation.

### Project Save & Load

Every generated app is automatically saved to the database. The dashboard shows a paginated history of all past generations with truncated prompts. Open any project to resume iterating, rename it, or delete it. Full CRUD with ownership scoping -- users only see their own projects.

### Authentication & Security

Sign in with GitHub for frictionless access. JWT tokens are stored in httpOnly cookies (no XSS exposure). Per-user rate limiting prevents API budget abuse. Security headers (HSTS, CSP, X-Frame-Options, nosniff) are applied to all responses. CORS is locked down to the configured frontend origin.

---

## Quick Start (Local Development)

### Prerequisites

- Python 3.12+
- Node.js 20+
- An [OpenCode Go API key](https://opencode.ai/auth)

### Backend

```bash
git clone https://github.com/AdarshKhandare/ai-builder.git
cd ai-builder/backend

python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt

cp .env.example .env
# Edit .env and set OPENCODE_API_KEY (+ auth vars if needed)

uvicorn app.main:app --reload
# Runs on http://localhost:8000
```

### Frontend

```bash
cd ai-builder/frontend
npm install
npm run dev
# Runs on http://localhost:5173 (proxies /api to :8000)
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `OPENCODE_API_KEY` | Yes | API key for the OpenCode Go gateway | `oc_sk_...` |
| `OPENCODE_BASE_URL` | No | Base URL of the OpenCode Go API | `https://opencode.ai/zen/go/v1` |
| `DATABASE_URL` | No | SQLAlchemy async database URL | `sqlite+aiosqlite:///./data/forge.db` |
| `ALLOWED_ORIGINS` | No | CORS allowed origins (JSON list) | `["http://localhost:5173"]` |
| `PLANNER_MODEL` | No | Model ID override for the planner agent | `opencode-go/deepseek-v4-flash` |
| `GITHUB_CLIENT_ID` | Yes* | GitHub OAuth app client ID | `Iv1.abc123...` |
| `GITHUB_CLIENT_SECRET` | Yes* | GitHub OAuth app client secret | `secret_...` |
| `JWT_SECRET` | Yes* | Secret key for JWT signing (min 32 chars) | `your-secret-key-here` |
| `FRONTEND_URL` | Yes* | Frontend URL for OAuth redirect | `http://localhost:5173` |

*\* Required for authentication features. The app functions without auth in local development.*

Copy `backend/.env.example` to `backend/.env` and fill in the required values.

---

## API Reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/health` | No | Service status and available models |
| `GET` | `/api/models` | No | Full model catalogue with pricing metadata |
| `POST` | `/api/auth/login` | No | GitHub OAuth redirect (302) |
| `GET` | `/api/auth/callback` | No | GitHub OAuth callback, sets JWT cookie |
| `GET` | `/api/auth/me` | Yes | Current authenticated user |
| `POST` | `/api/auth/logout` | Yes | Clear JWT cookie |
| `POST` | `/api/generate` | Yes | Stream generated code as SSE |
| `POST` | `/api/iterate` | Yes | Stream iteration update as SSE |
| `GET` | `/api/projects` | Yes | List projects (paginated, newest first) |
| `GET` | `/api/projects/{id}` | Yes | Get single project with full code |
| `POST` | `/api/projects` | Yes | Create a new project |
| `PATCH` | `/api/projects/{id}` | Yes | Partial update (title / code / model) |
| `DELETE` | `/api/projects/{id}` | Yes | Delete project (204 on success) |

### POST /api/generate

**Request body:**

```json
{
  "prompt": "A todo app with dark mode and drag-and-drop",
  "model": "opencode-go/deepseek-v4-flash"
}
```

**SSE event sequence:**

| Event | `type` | Payload | Description |
|-------|--------|---------|-------------|
| 1 | `status` | `"planning"` | Planner agent started |
| 2 | `title` | `"Todo App"` | Extracted project title |
| 3 | `status` | `"generating"` | Coder agent started |
| 4 | `code` | `"<html>..."` | Streamed code chunks (N frames) |
| 5 | `done` | -- | Generation complete |
| -- | `error` | `"AI model error (status 500)"` | Emitted on failure |

### POST /api/iterate

**Request body:**

```json
{
  "prompt": "Add a delete button to each todo item",
  "current_code": "<!DOCTYPE html>...",
  "history": [
    {"role": "user", "content": "Create a todo app"},
    {"role": "assistant", "content": "<!DOCTYPE html>..."}
  ],
  "model": "opencode-go/deepseek-v4-flash"
}
```

**SSE event sequence:** `status("iterating")` -> `code` (N chunks) -> `done`. A `: keepalive` comment is injected every 15 seconds during slow streams. The entire request is capped at 5 minutes.

### GET /api/projects

| Param | Default | Max | Description |
|-------|---------|-----|-------------|
| `limit` | 50 | 200 | Number of projects to return |
| `offset` | 0 | -- | Number of rows to skip |

---

## Available AI Models

| Model | Tier | Input ($/M) | Output ($/M) | Context | Default |
|-------|------|-------------|--------------|---------|---------|
| DeepSeek V4 Flash | Very cheap | $0.14 | $0.28 | 128K | Yes |
| MiMo V2.5 | Very cheap | $0.14 | $0.28 | 128K | |
| MiniMax M2.7 | Medium | $0.30 | $1.20 | 200K | |
| Qwen3.6 Plus | Medium | $0.50 | $3.00 | 131K | |
| DeepSeek V4 Pro | Medium | $1.74 | $3.48 | 128K | |
| MiniMax M3 | Upper-medium | $0.30 | $1.20 | 200K | |
| Qwen3.7 Plus | Upper-medium | $0.40 | $1.60 | 131K | |
| Kimi K2.6 | Upper-medium | $0.95 | $4.00 | 256K | |

Cost-aware routing ensures the planner always runs on the cheapest model (DeepSeek V4 Flash) while the coder uses the user's selection. Average cost per generation: ~$0.008.

---

## Testing

### Backend (pytest)

```bash
cd backend
pytest
```

64 tests covering API contracts, SSE event sequences, dual-protocol streaming, auth flows, rate limiting, and project ownership scoping.

### Frontend (vitest)

```bash
cd frontend
npm test
```

128 tests covering React components, custom hooks (useSSE, useProjects, useModels), utility functions, and streaming state management.

**Total: 192 tests across the stack.**

---

## Deployment

The backend runs on an Oracle Cloud Always Free ARM VPS (Ubuntu 24.04) containerized with Docker and reverse-proxied by Nginx with Let's Encrypt SSL. The frontend deploys to Vercel on every push to `main`. DNS is managed through Hostinger with Cloudflare for DDoS protection and edge caching. CI/CD is handled by GitHub Actions -- pushes to `main` trigger an SSH deploy to the VPS and a Vercel production build simultaneously.

---

## Security

| Layer | Implementation |
|-------|---------------|
| **Authentication** | GitHub OAuth 2.0 with state parameter, JWT in httpOnly cookies |
| **Rate limiting** | Per-user limits via slowapi (configurable per endpoint) |
| **Authorization** | Project ownership scoping -- users can only access their own projects |
| **Headers** | HSTS, Content-Security-Policy, X-Frame-Options, X-Content-Type-Options |
| **CORS** | Locked to configured frontend origin, credentials allowed |
| **Input validation** | Pydantic v2 models with field-level constraints (min/max length, regex patterns) |
| **Database** | SQLAlchemy 2.0 with parameterized queries (no raw SQL) |
| **Preview isolation** | Sandboxed iframe (`allow-scripts allow-same-origin`) prevents parent page access |
| **Secrets** | All API keys and secrets in `.env`, loaded via pydantic-settings, never hardcoded |

---

## License

MIT

---

## Author

**Adarsh Khandare** -- Senior full-stack developer specializing in React, TypeScript, and AI-integrated systems.

- [GitHub](https://github.com/AdarshKhandare)
- [Portfolio](https://adarshweb.in)
