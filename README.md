# Forge -- AI Web Builder

> Describe it. Forge builds it.

Forge is an AI-powered web builder that turns natural-language descriptions into working single-page web applications. Type what you want, and a multi-agent pipeline plans the architecture, generates the code, and streams it to a live preview -- all in real time. Built as a full-stack portfolio project: React frontend, Python AI backend, and OpenCode Go model routing.

---

## Live Demo

| Service | URL | Status |
|---------|-----|--------|
| Frontend | [ai-builder.adarshweb.in](https://ai-builder.adarshweb.in) | Coming soon |
| Backend API | [api.ai-builder.adarshweb.in/api/health](https://api.ai-builder.adarshweb.in/api/health) | Coming soon |

---

## Features

- **Natural language to working app** -- describe an app in plain English, get production-ready HTML/CSS/JS
- **Real-time streaming** -- code is streamed token-by-token via Server-Sent Events (SSE) as the AI generates it
- **Live preview** -- rendered in a sandboxed iframe that updates as code arrives
- **Chat-based iteration** -- refine generated apps through follow-up prompts
- **Multiple AI models** -- choose from 9 models (MiniMax M3, DeepSeek V4 Flash, Qwen3.7, Kimi K2.6, GLM 5.2, MiMo V2.5 Pro) balancing cost and capability
- **Project save/load** -- persist generated apps to the database, resume editing later
- **Project history** -- paginated dashboard of all past generations
- **ZIP download** -- export generated apps as downloadable archives (stretch goal)

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Frontend** | React 19 + Vite + TypeScript + shadcn/ui + TailwindCSS v4 + framer-motion + GSAP | Fast iteration, strong type safety, modern UI primitives |
| **Backend** | Python 3.12 + FastAPI + Uvicorn | Async-native, high performance, standard for Python API servers |
| **AI Models** | OpenCode Go API (MiniMax M3 primary coder, DeepSeek V4 Flash planner) | Open-source models, ~$0.008 per generation, ~2,500 apps on a $20 balance |
| **Persistence** | SQLite via aiosqlite + SQLAlchemy async | Zero setup, sufficient for portfolio scale |
| **Frontend Deploy** | Vercel Hobby (free) | Zero-config Vite + React hosting |
| **Backend Deploy** | Oracle Cloud Always Free ARM VPS | No request timeouts for AI streams, 12GB RAM, Docker + Nginx |
| **DNS / SSL / CDN** | Cloudflare Free | Existing `adarshweb.in` domain on Cloudflare |

---

## Architecture

A multi-agent pipeline orchestrates generation. The user prompt passes through a planner (DeepSeek V4 Flash) that produces a structured build plan, then a coder (MiniMax M3) that streams HTML/CSS/JS tokens back to the frontend over SSE. A reviewer agent (DeepSeek V4 Flash) validates output quality.

```
User (React frontend)
  |
  |  POST /api/generate  { prompt, model }
  v
FastAPI (Python 3.12)
  |
  |-- 1. Planner agent (DeepSeek V4 Flash)
  |       prompt --> structured build plan
  |
  |-- 2. Extract title from plan
  |       --> SSE: {"type":"title", "content":"My App"}
  |
  |-- 3. Coder agent (MiniMax M3)
  |       plan --> HTML/CSS/JS code
  |       --> SSE: {"type":"code", "content":"<chunk>"} (N frames)
  |
  v
SSE Stream --> React useSSE hook --> Live Preview (sandboxed iframe)
```

---

## Project Structure

```
ai_builder/
├── frontend/                      # React 19 + Vite + shadcn/ui + TailwindCSS v4
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/                # shadcn primitives (button, card, dialog, etc.)
│   │   │   ├── layout/            # PanelLayout, TopBar, StatusBar
│   │   │   ├── chat/              # ChatPanel, MessageBubble, StreamingText
│   │   │   ├── code/              # CodePanel, SyntaxHighlighter
│   │   │   ├── preview/           # PreviewPanel, DeviceFrame
│   │   │   └── landing/           # Hero, Features, HowItWorks, TemplateGallery
│   │   ├── hooks/                 # useReducedMotion, useTheme, useSSE
│   │   ├── lib/                   # motion.ts, gsap.ts, api.ts, utils.ts
│   │   ├── styles/                # fonts.css, scrollbar.css, animations.css
│   │   └── pages/                 # Landing, Builder (route pages)
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── package.json
├── backend/                       # Python FastAPI + AI agents
│   ├── app/
│   │   ├── main.py                # FastAPI app, CORS, route mounting
│   │   ├── routes/
│   │   │   ├── generate.py        # POST /api/generate -- streaming SSE
│   │   │   ├── projects.py        # CRUD /api/projects -- save/load
│   │   │   └── health.py          # GET /api/health + model list
│   │   ├── agents/
│   │   │   ├── planner.py         # Prompt --> plan (DeepSeek V4 Flash)
│   │   │   ├── coder.py           # Plan --> code (MiniMax M3)
│   │   │   └── reviewer.py        # Code --> review (DeepSeek V4 Flash)
│   │   ├── services/
│   │   │   ├── opencode_client.py # OpenCode Go API client (httpx, SSE)
│   │   │   └── code_generator.py  # Orchestrates planner --> coder --> reviewer
│   │   ├── models/
│   │   │   ├── schemas.py         # Pydantic request/response models
│   │   │   └── database.py        # SQLAlchemy async engine + models
│   │   └── config.py              # Settings from environment / .env
│   ├── tests/                     # pytest test suite
│   ├── data/                      # SQLite DB file (gitignored)
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
├── docker-compose.yml             # Backend container orchestration
├── .gitignore
└── README.md                      # This file
```

---

## Prerequisites

- **Python 3.12+**
- **Node.js 20+** and npm
- An **OpenCode Go API key** from [opencode.ai/auth](https://opencode.ai/auth)

---

## Quick Start (Local Development)

### 1. Clone the repository

```bash
git clone https://github.com/AdarshKhandare/ai-builder.git
cd ai-builder
```

### 2. Backend

```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt

cp .env.example .env
# Edit .env and set OPENCODE_API_KEY

uvicorn app.main:app --reload
# Runs on http://localhost:8000
```

### 3. Frontend

```bash
cd frontend
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

Copy `backend/.env.example` to `backend/.env` and fill in your API key before starting the backend.

---

## API Reference

### Health Check

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Returns service status and list of available AI models |

### Code Generation

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/generate` | Streams generated code as Server-Sent Events |

**Request body:**

```json
{
  "prompt": "A todo app with dark mode",
  "model": "opencode-go/minimax-m3"
}
```

**SSE event sequence:**

| Event | `type` | `content` / `message` | Description |
|-------|--------|------------------------|-------------|
| 1 | `status` | `"planning"` | Planner agent started |
| 2 | `title` | `"Todo App"` | Extracted project title |
| 3 | `status` | `"generating"` | Coder agent started |
| 4 | `code` | `"<html>..."` | One or more streamed code chunks |
| 5 | `done` | -- | Generation complete |
| -- | `error` | `"AI model error (status 500)"` | Emitted on failure |

### Projects (CRUD)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects` | List projects (paginated, newest first, prompts truncated) |
| `GET` | `/api/projects/{id}` | Get a single project with full code body |
| `POST` | `/api/projects` | Create a new project |
| `PATCH` | `/api/projects/{id}` | Partially update title / code / model |
| `DELETE` | `/api/projects/{id}` | Delete a project (204 on success, 404 if not found) |

**Query parameters for `GET /api/projects`:**

| Param | Default | Max | Description |
|-------|---------|-----|-------------|
| `limit` | 50 | 200 | Number of projects to return |
| `offset` | 0 | -- | Number of rows to skip |

---

## Available AI Models

| Model ID | Name | Role | Input Cost ($/1M tokens) | Output Cost ($/1M tokens) |
|----------|------|------|--------------------------|---------------------------|
| `opencode-go/minimax-m3` | MiniMax M3 | Primary coder | $0.30 | $1.20 |
| `opencode-go/deepseek-v4-flash` | DeepSeek V4 Flash | Planner / reviewer | $0.14 | $0.28 |
| `opencode-go/deepseek-v4-pro` | DeepSeek V4 Pro | Deep code review | $1.74 | $3.48 |
| `opencode-go/kimi-k2.6` | Kimi K2.6 | Daily use | $0.95 | $4.00 |
| `opencode-go/kimi-k2.7-code` | Kimi K2.7 Code | Code specialist | $0.95 | $4.00 |
| `opencode-go/qwen3.7-plus` | Qwen3.7 Plus | Versatile reasoning | $0.40 | $1.60 |
| `opencode-go/qwen3.7-max` | Qwen3.7 Max | High reasoning | $2.50 | $7.50 |
| `opencode-go/glm-5.2` | GLM 5.2 | Orchestration | $1.40 | $4.40 |
| `opencode-go/mimo-v2.5-pro` | MiMo V2.5 Pro | Documentation | $1.74 | $3.48 |

The default coder model is `opencode-go/minimax-m3`. The planner model defaults to `opencode-go/deepseek-v4-flash` and can be overridden via the `PLANNER_MODEL` environment variable.

---

## Testing

### Backend (pytest)

```bash
cd backend
pytest
```

### Frontend (vitest)

```bash
cd frontend
npm test
```

---

## Docker

The backend can be containerized and run with Docker Compose:

```bash
# From the repo root
cp backend/.env.example backend/.env
# Edit backend/.env -- set OPENCODE_API_KEY

docker compose up -d --build
# Backend runs on http://localhost:8000
```

The container mounts `backend/data/` as a volume for SQLite persistence and includes a health check on `/api/health`.

---

## Deployment

| Layer | Platform | Status |
|-------|----------|--------|
| Backend | Oracle Cloud Always Free ARM VPS (Ubuntu 24, Docker + Nginx) | In progress |
| Frontend | Vercel Hobby (free) | In progress |
| DNS / SSL | Hostinger domain + Cloudflare | In progress |

**Planned domains:**

- Frontend: `ai-builder.adarshweb.in`
- Backend API: `api.ai-builder.adarshweb.in`

---

## Roadmap

- [ ] Chat-based iteration (follow-up prompts to refine generated apps)
- [ ] Model picker UI (let users choose which AI model to use)
- [ ] ZIP download (export generated apps as downloadable archives)
- [ ] Full deployment pipeline (Oracle Cloud + Vercel + Cloudflare)
- [ ] React output mode (stretch -- generate React components instead of raw HTML)

---

## License

MIT

---

## Author

**Adarsh Khandare** -- [GitHub](https://github.com/AdarshKhandare)
