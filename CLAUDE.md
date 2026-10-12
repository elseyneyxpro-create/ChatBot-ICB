# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Overview

This is a monorepo with three services:

```
ChatBot-ICB/
├── chatbot-icb-backend-main/        # NestJS BFF (port 3000)
├── chatbot-icb-frontend-main/       # Angular 18 (port 4200)
└── chatbot-icb-agents-service-main/ # Python FastAPI AI service (port 8000)
```

**Request flow:** Frontend → NestJS BFF → Python AI Service → LLM (OpenAI or Vertex AI)

The NestJS backend acts purely as a BFF: it handles authentication/authorization and proxies AI requests to the Python service. The Python service owns all LLM logic (LangChain, prompt templates, conversation memory).

---

## Commands

### Backend (NestJS)
```bash
cd chatbot-icb-backend-main
npm install
npm run start:dev      # Dev with watch mode
npm run build
npm run lint
npm run test           # Unit tests
npm run test:e2e       # E2E tests
npm run test:cov       # Coverage
```

### Frontend (Angular 18)
```bash
cd chatbot-icb-frontend-main
npm install
npm run start          # ng serve on port 4200
npm run build
npm run test           # Karma unit tests
```

### AI Service (Python/FastAPI)
```bash
cd chatbot-icb-agents-service-main
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000 --log-level info
```

### Database
```bash
cd deploy
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL+pgvector :5432 y MongoDB :27017 locales
```
- **PostgreSQL** (antes Supabase): tema, contenido_tema, videos, usuario, whitelist_alumnos, función `match_contenido`.
- **MongoDB** (antes Firestore): Chat_nr, Hilo_chat, Contexto_chat, Perfil_usuario, nivel_usuario.
- Despliegue completo en la VM (solo puerto 443): ver `deploy/README.md`.

---

## Backend Structure (NestJS)

- **`src/auth/`** — Google OAuth (passport) → whitelist en Postgres → JWT en cookie httpOnly `accessToken`. Sin Supabase Auth ni Firebase Auth.
- **`src/database/`** — `PostgresService` (pg) y `MongoService` (mongodb), globales.
- **`src/modules/chats/`**, **`src/modules/profile/`** — chats, hilos, perfil y leaderboard en Mongo (antes el frontend escribía directo en Firestore). El uid sale siempre del JWT.
- **`src/modules/ai/`** — Single controller `POST /v1/ai/answer` (JWT-guarded), proxies to Python service with retry logic. `GET /v1/ai/health` is public.
- **`src/prisma/`** — Global `PrismaService`, connects on `onModuleInit`.
- **`prisma/schema.prisma`** — User model: `id` (UUID), `email` (unique), `password_hash`, `first_name`, `last_name`, `rut` (unique), `is_verified`.
- API versioning is URI-based (default v1), configured in `main.ts`.

**Required env vars:** `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `PYTHON_BASE_URL`, `PYTHON_ANSWER_PATH`, `PYTHON_MAX_RETRIES`, `CORS_ORIGINS`, `PORT`.

## Nivelación (módulo hermano del chatbot)

- **DB:** `deploy/sql/nivelacion.sql` — esquemas `niv_banco` (preguntas de profesores) y `niv_progreso` (nivel, XP, fases, intentos, análisis). Acceso al chatbot: columna `whitelist_alumnos.chatbot_habilitado` (antiguos true, nuevos false, se activa sola al completar la nivelación).
- **Backend:** `src/modules/nivelacion/` — `/v1/nivelacion/*`. `ChatbotHabilitadoGuard` bloquea chats/ai/profile si `whitelist_alumnos.chatbot_habilitado` es false.
- **Python:** `app/routers/nivelacion/` — `/niv/generar` (preguntas para modo Entrenar, no se guardan en el banco) y `/niv/analizar` (agente analista, ajusta el nivel).
- **Frontend:** `src/app/features/nivelacion/` (port a Angular de la maqueta React de `C:\Propuesta`), ruta `/nivelacion`; `chatbotGuard` redirige ahí si el chatbot no está habilitado.

## Frontend Structure (Angular 18)

Uses **standalone components** and **Angular signals** throughout — no NgModules.

- **`src/app/core/auth.service.ts`** — Auth state via signals. Calls `/auth/profile`, `/auth/signin`, `/auth/signup`, `/auth/signout`.
- **`src/app/core/chat.service.ts`** — Chat messages via signals. `ask(question, subject, session_id)` → `POST /v1/ai/answer`.
- **`src/app/core/http-auth.interceptor.ts`** — Attaches JWT to all requests.
- **Routes:** `/login`, `/signup`, `/auth/callback` (Google OAuth), `/app/chat` (guarded), `/app/library` (guarded).
- **`src/environments/environment.ts`** — Set `API_URL` and `auth.loginUrl` for the environment.

## AI Service Structure (Python/FastAPI)

- **`app/core/config.py`** — Pydantic Settings. `LLM_PROVIDER` selects "openai" (GPT-4o-mini) or "vertex" (Gemini-2.5-flash). Memory TTL and max turns configurable.
- **`app/core/chain.py`** — LangChain chain with a Spanish math tutor system prompt (designed for UDP ICB students). Conversation history injected into prompt template.
- **`app/core/memory.py`** — Session-keyed in-memory conversation store with TTL and turn limits.
- **`app/api/v1/answer.py`** — `POST /ai/answer` receives `{ session_id, question, subject }`, returns `{ ok, reply, latency_ms, provider, model }`.

**Required env vars:** `LLM_PROVIDER`, `OPENAI_API_KEY` (if openai), `OPENAI_MODEL`, `GCP_PROJECT` (if vertex), `GOOGLE_APPLICATION_CREDENTIALS`, `VERTEX_MODEL`, `MEM_TTL_SECONDS`, `MEM_MAX_TURNS`.
