<div align="center">

# ✦ Axiomante

**Tutor de Cálculo con IA · Instituto de Ciencias Básicas · Universidad Diego Portales**

Chatbot con pensamiento crítico + módulo de **Nivelación** gamificado, todo corriendo en **una sola VM** detrás del puerto 443.

`Angular 18` · `NestJS 11` · `FastAPI + LangChain` · `PostgreSQL 17 + pgvector` · `MongoDB 7` · `Nginx` · `Docker Compose`

</div>

---

## 📑 Índice

1. [Qué es esto](#-qué-es-esto)
2. [Arquitectura](#-arquitectura)
3. [Qué cambió (rama `migracion-vm`)](#-qué-cambió-rama-migracion-vm)
4. [Estructura del repo](#-estructura-del-repo)
5. [Levantarlo en tu PC (desarrollo)](#-levantarlo-en-tu-pc-desarrollo)
6. [Montarlo en la VM de la universidad (producción)](#-montarlo-en-la-vm-de-la-universidad-producción)
7. [Bases de datos](#-bases-de-datos)
8. [Módulo de Nivelación](#-módulo-de-nivelación)
9. [Gestión de alumnos (SQL listo para copiar)](#-gestión-de-alumnos-sql-listo-para-copiar)
10. [API del backend](#-api-del-backend)
11. [Frontend: estética y navegación](#-frontend-estética-y-navegación)
12. [Variables de entorno](#-variables-de-entorno)
13. [Problemas comunes](#-problemas-comunes)
14. [Checklist antes de producción](#-checklist-antes-de-producción)
15. [Equipo](#-equipo)

---

## 🧠 Qué es esto

Axiomante tiene **dos módulos** que comparten login y usuarios:

| Módulo | Qué hace |
|---|---|
| **Chatbot** | El alumno pregunta de Cálculo. Un agente responde con LaTeX, busca contenido con RAG (pgvector) y genera un panel de **pensamiento crítico** con ejercicios (concepto, verdadero/falso, encuentra el error) y videos. Si hay un error grave, el chat se bloquea hasta resolver los ejercicios. |
| **Nivelación** | Mapa tipo *Mario Bros* de mundos → nodos → fases. Preguntas base de los profesores, modo **Entrenar** con preguntas generadas por IA y un **agente analista** que ajusta el nivel del alumno. Al completarla, se habilita el chatbot. |

---

## 🏗 Arquitectura

```mermaid
flowchart LR
    U([🧑‍🎓 Navegador]) -- HTTPS 443 --> N[Nginx]
    N -- "/" --> F[Angular SPA<br/>archivos estáticos]
    N -- "/api/*  (quita /api)" --> B[NestJS BFF :3000]
    B -- "X-Internal-Secret" --> A[FastAPI agents :8000]
    B --> P[(PostgreSQL 17<br/>+ pgvector)]
    B --> M[(MongoDB 7)]
    A --> P
    A --> M
    A -- API --> O[[OpenAI]]
    B -. OAuth .-> G[[Google]]
```

- **Solo el puerto 443 queda abierto.** Postgres y Mongo escuchan únicamente en `127.0.0.1` de la VM.
- **NestJS es el único que habla con el navegador**: valida la sesión (cookie `accessToken`, JWT httpOnly), saca el `uid` del token (nunca del body) y verifica que cada chat sea del usuario.
- **El servicio Python** tiene toda la lógica de IA (LangChain, prompts, RAG, agentes de nivelación). Solo acepta llamadas del backend con el secreto interno.

### Flujo de una pregunta en el chat

```mermaid
sequenceDiagram
    participant F as Angular
    participant B as NestJS
    participant A as Agents (Python)
    participant DB as Postgres / Mongo
    F->>B: POST /api/v1/ai/answer (cookie)
    B->>B: uid desde JWT + dueño del chat
    B->>A: /ai/answer {uid, chat, pregunta}
    A->>DB: match_contenido (pgvector) + historial
    A-->>B: respuesta + tema
    B-->>F: respuesta (KaTeX)
    A->>DB: guarda reinforcement (en segundo plano)
    loop cada 2 s
        F->>B: GET /api/v1/chats/:id
        B-->>F: last_reinforcement
    end
```

### Flujo de login

```mermaid
sequenceDiagram
    participant F as Angular
    participant B as NestJS
    participant G as Google
    F->>B: GET /api/auth/google
    B->>G: OAuth (solo @mail.udp.cl)
    G-->>B: callback con el perfil
    B->>B: ¿está en whitelist_alumnos? reutiliza id_user por correo
    B-->>F: cookie accessToken + redirect /auth/callback
    F->>B: GET /api/auth/profile → { chatbot_habilitado }
    F->>F: 1ª vez del día → /inicio · si no → /app (el guard decide chat o nivelación)
```

---

## 🔄 Qué cambió (rama `migracion-vm`)

| Commit | Contenido |
|---|---|
| `Migración a VM + módulo de nivelación` | Salida de Supabase/Firebase/GCP/Netlify, Docker Compose, Nginx, scripts de migración, módulo de nivelación completo |
| `Estética fase 0-2` | Modo claro/oscuro, marca Axiomante, menú lateral y pantalla del chat rediseñados |
| `Estética fase 3` | Leaderboard, perfil, biblioteca, login y nivelación con los mismos tokens de diseño |
| `Paneles plegables…` | Mis chats y Pensamiento crítico se pliegan a una barra; botón directo Nivelación → Chatbot; `/inicio` solo 1 vez al día |
| `KaTeX: no convertir saltos…` | Arreglo de fórmulas que salían como `\nf` en rojo |

### Antes vs ahora

| Antes (nube) | Ahora (VM) |
|---|---|
| Supabase Auth + Firebase custom token | Login Google directo en NestJS (`passport-google-oauth20`) + cookie JWT |
| Supabase (tablas + `match_contenido`) | PostgreSQL 17 + pgvector, mismas tablas y función |
| Firestore escrito **directo desde el frontend** | MongoDB, todo pasa por endpoints del backend |
| `onSnapshot` para el reinforcement | Polling cada 2 s a `GET /api/v1/chats/:id` |
| El frontend mandaba el `uid` | El backend lo toma del JWT |
| `Perfil_usuario/{uid}/nivel_usuario/{tema}` | Colección plana `nivel_usuario { uid, tema, … }` (índice único) |
| Backend en GCP México, front en Netlify | Todo en la VM con Docker Compose |
| Logo UDP, tema único | Marca **Axiomante**, modo claro/oscuro |

Los usuarios **mantienen su historial**: al hacer login se busca su correo en la tabla `usuario` (migrada) y se reutiliza su `id_user`, que es el mismo uid que tenían en Firestore.

---

## 📂 Estructura del repo

```
ChatBot-ICB/
├── chatbot-icb-frontend-main/        Angular 18 (standalone + signals, Angular Material)
│   └── src/app/
│       ├── core/                     auth, guards, data.service, theme.service
│       ├── shared/                   message-list, message-input, katex-render.pipe
│       └── features/
│           ├── shell/                menú lateral + topbar (tema, salir)
│           ├── chat/chat-page/       chat de 3 columnas con paneles plegables
│           ├── inicio/               selector de módulo (Chatbot / Nivelación)
│           ├── nivelacion/           mapa de mundos, nodos, evaluación, entrenar
│           ├── profile/ leaderboard/ library/ auth/
├── chatbot-icb-backend-main/         NestJS 11 (BFF)
│   └── src/
│       ├── auth/                     Google OAuth + JWT
│       ├── database/                 PostgresService (pg Pool) + MongoService
│       └── modules/                  ai, chats, profile, users, nivelacion
├── chatbot-icb-agents-service-main/  FastAPI + LangChain
│   └── app/
│       ├── core/                     config, postgres, mongo
│       └── routers/                  ai (tutor, clasificador, reinforcer, analista) · nivelacion (generar, analizar)
└── deploy/
    ├── docker-compose.yml            producción (VM)
    ├── docker-compose.dev.yml        solo Postgres :55432 + Mongo :27017 para tu PC
    ├── nginx/                        default.conf.template + certs/
    ├── sql/nivelacion.sql            esquemas niv_banco / niv_progreso + seed
    ├── migracion/                    Supabase → Postgres, Firestore → Mongo, importar_local.ps1
    └── README.md                     guía corta de despliegue
```

---

## 💻 Levantarlo en tu PC (desarrollo)

### Requisitos

- Docker Desktop corriendo
- Node 20+ y npm
- Python 3.10+
- Credenciales (no se suben al repo):
  - **Supabase**: Project Settings → Database → Connect → *Session pooler* (URI con la clave)
  - **Firebase**: Configuración → Cuentas de servicio → *Generar nueva clave privada* → guárdala como `deploy/migracion/firebase-credentials.json`
  - **OpenAI** API key
  - **Google OAuth** client ID + secret

### 1 · Configurar los `.env`

```powershell
copy chatbot-icb-backend-main\.env.example        chatbot-icb-backend-main\.env
copy chatbot-icb-agents-service-main\.env.example chatbot-icb-agents-service-main\.env
```

Completa `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OPENAI_API_KEY` y usa el **mismo valor** en `PYTHON_INTERNAL_SECRET` (backend) e `INTERNAL_SECRET` (agents).

En Google Cloud Console → Credenciales → tu cliente OAuth, agrega la URI de redirección:

```
http://localhost:3000/auth/google/callback
```

### 2 · Bases de datos con datos reales

```powershell
cd deploy\migracion
powershell -ExecutionPolicy Bypass -File .\importar_local.ps1 `
  -SupabaseDbUrl "postgresql://postgres.xxxx:CLAVE@aws-1-sa-east-1.pooler.supabase.com:5432/postgres" `
  -FirebaseCred ".\firebase-credentials.json"
```

Esto levanta `docker-compose.dev.yml` (Postgres en **55432**, Mongo en **27017**), copia Supabase → Postgres, Firestore → Mongo y aplica `deploy/sql/nivelacion.sql`.

> ¿Solo quieres las bases vacías? `docker compose -f deploy\docker-compose.dev.yml up -d`

### 3 · Tres terminales

```powershell
# Terminal 1 — agentes IA
cd chatbot-icb-agents-service-main
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Terminal 2 — backend
cd chatbot-icb-backend-main
npm install
npm run start:dev

# Terminal 3 — frontend
cd chatbot-icb-frontend-main
npm install
npm start
```

Abre **http://localhost:4200** y entra con una cuenta `@mail.udp.cl` que esté en `whitelist_alumnos`.
`ng serve` usa `proxy.conf.json`: `/api/*` → `http://localhost:3000` (sin el `/api`), igual que Nginx en producción.

| Servicio | URL local |
|---|---|
| Frontend | http://localhost:4200 |
| Backend | http://localhost:3000 |
| Agents (docs Swagger) | http://localhost:8000/docs |
| Postgres | `localhost:55432` · usuario `icb_user` · clave `icb_dev` · base `icb_chatbot` |
| Mongo | `mongodb://localhost:27017` · base `icb_chatbot` |

---

## 🚀 Montarlo en la VM de la universidad (producción)

```mermaid
flowchart TD
    A[1 · Pedir dominio + certificado a TI] --> B[2 · Autorizar redirect URI en Google]
    B --> C[3 · Clonar repo y crear deploy/.env]
    C --> D[4 · docker compose up -d --build]
    D --> E[5 · Migrar Supabase → Postgres]
    E --> F[6 · Migrar Firestore → Mongo]
    F --> G[7 · Aplicar nivelacion.sql]
    G --> H[8 · Reiniciar backend + agents y probar]
```

1. **Dominio + certificado.** Google OAuth no acepta IPs. Pide a TI un nombre (ej. `axiomante.icb.udp.cl`) y su certificado. Deja `fullchain.pem` y `privkey.pem` en `deploy/nginx/certs/`.
2. **Google Cloud Console** → cliente OAuth → URI de redirección:
   ```
   https://DOMINIO/api/auth/google/callback
   ```
3. **Configurar:**
   ```bash
   git clone <repo> && cd ChatBot-ICB && git checkout migracion-vm
   cd deploy && cp .env.example .env && nano .env
   ```
   Genera secretos largos con `openssl rand -hex 32` para `INTERNAL_SECRET` y `JWT_SECRET`.
4. **Levantar todo:**
   ```bash
   docker compose up -d --build
   docker compose ps          # postgres y mongo deben quedar "healthy"
   ```
5. **Migrar Supabase → Postgres:**
   ```bash
   SUPABASE_DB_URL='postgresql://...' bash migracion/01_supabase_a_postgres.sh
   ```
6. **Migrar Firestore → Mongo** (en la VM, o desde tu PC con túnel SSH al 27017):
   ```bash
   python migracion/02_firestore_a_mongo.py --cred firebase-credentials.json \
     --mongo "mongodb://USER:PASS@localhost:27017/?authSource=admin"
   ```
7. **Nivelación:**
   ```bash
   docker compose exec -T postgres psql -U icb_user -d icb_chatbot < sql/nivelacion.sql
   ```
8. `docker compose restart backend agents` y entra a `https://DOMINIO`.

### Comandos del día a día

```bash
docker compose logs -f backend agents                       # logs en vivo
docker compose exec postgres psql -U icb_user -d icb_chatbot # consola SQL
docker compose exec mongo mongosh -u icb_user -p             # consola Mongo
git pull && docker compose up -d --build                     # actualizar
docker compose exec -T postgres pg_dump -U icb_user icb_chatbot > respaldo_$(date +%F).sql   # respaldo
```

---

## 🗄 Bases de datos

### PostgreSQL (relacional + vectores)

| Tabla / esquema | Para qué |
|---|---|
| `usuario` | Usuarios migrados (`id_user` = uid histórico) |
| `whitelist_alumnos` | Quién puede entrar · **`nivel_inicial`** · **`chatbot_habilitado`** |
| tablas de contenido + `match_contenido()` | RAG con pgvector (mismo esquema que Supabase) |
| `niv_banco.*` | `mundo`, `nodo`, `pregunta` — banco de los profesores |
| `niv_progreso.*` | `estudiante`, `progreso_nodo`, `progreso_test`, `intento`, `analisis` |

### MongoDB (documentos)

| Colección | Para qué |
|---|---|
| `Chat_nr` | Chats del alumno (nombre, `last_reinforcement`, `last_videos`) |
| `Hilo_chat` | Mensajes encadenados de cada chat |
| `Contexto_chat` | Memoria de conversación del agente |
| `Perfil_usuario` | Perfil y puntos a reforzar |
| `nivel_usuario` | Estadísticas por tema (único por `uid + tema`) |
| `niv_generadas` | Preguntas de *Entrenar* pendientes (TTL 2 h, no van al banco) |

---

## 🎮 Módulo de Nivelación

```mermaid
flowchart LR
    W1[🌍 Mundo 1] --> W2[🌍 Mundo 2] --> W3[🌍 Mundo 3] --> W4[🌍 Mundo 4] --> FIN([🏆 Chatbot habilitado])
    subgraph Mundo
      direction LR
      N1((Nodo 1)) --> N2((Nodo 2)) --> N3((…)) --> N10((Nodo 10)) --> T{{Test final}}
    end
```

| Regla | Valor |
|---|---|
| Fases por nodo | **4** (4 preguntas cada una) |
| Para aprobar | **≥ 70 %** |
| Test del mundo | **2 fases**, 10 preguntas; la fase 2 usa un nivel más alto |
| XP | fase **10** · test fase 1 **250** · test fase 2 **500** · entrenar **5** · 100 XP por nivel |
| Corrección | Siempre en el servidor (el frontend nunca recibe la respuesta correcta antes) |

- **Banco de los profesores** (`niv_banco.pregunta`): fases y tests usan solo estas preguntas.
- **Modo Entrenar**: el agente generador crea preguntas nuevas para el nodo. **No se guardan en el banco**; solo quedan como `intento` con `origen = 'generada'` (suman XP y alimentan al analista).
- **Agente analista**: corre después de cada fase/test y cada 5 entrenamientos. Guarda fortalezas, debilidades y recomendación, y **ajusta el nivel** (Principiante / Intermedio / Avanzado).
- **El alumno nunca elige su nivel**: parte con `whitelist_alumnos.nivel_inicial` (lo definen los profes).
- Al completar todos los mundos, el backend pone `chatbot_habilitado = true` y la pantalla lo celebra.

---

## 🧾 Gestión de alumnos (SQL listo para copiar)

| Tipo de alumno | `chatbot_habilitado` |
|---|---|
| Antiguos (ya estaban al aplicar `nivelacion.sql`) | `true` → siguen usando el chatbot |
| Nuevos (cualquier `INSERT` posterior) | `false` → solo ven la nivelación |
| Termina la nivelación | pasa a `true` automáticamente |

```sql
-- Cargar alumnos nuevos con el nivel inicial que definen los profesores
INSERT INTO whitelist_alumnos (email, activo, nivel_inicial) VALUES
  ('alumno1@mail.udp.cl', true, 'Intermedio'),
  ('alumno2@mail.udp.cl', true, 'Principiante');

-- Habilitar / bloquear a mano
UPDATE whitelist_alumnos SET chatbot_habilitado = true  WHERE lower(email) = 'alumno1@mail.udp.cl';
UPDATE whitelist_alumnos SET chatbot_habilitado = false WHERE lower(email) = 'alumno2@mail.udp.cl';

-- ¿Quiénes siguen pendientes?
SELECT email, nivel_inicial FROM whitelist_alumnos WHERE activo AND NOT chatbot_habilitado;

-- Avance de cada alumno en la nivelación
SELECT e.uid, e.nivel, e.xp, count(*) FILTER (WHERE pn.fases >= 4) AS nodos_completos
FROM niv_progreso.estudiante e
LEFT JOIN niv_progreso.progreso_nodo pn ON pn.uid = e.uid
GROUP BY e.uid, e.nivel, e.xp ORDER BY e.xp DESC;
```

### Agregar preguntas de los profesores

```sql
INSERT INTO niv_banco.pregunta
  (mundo_id, nodo_id, tipo, dificultad, enunciado, alternativas, correcta, explicacion, creado_por)
VALUES
  (1, (SELECT id FROM niv_banco.nodo WHERE mundo_id = 1 AND orden = 1), 'nodo', 'Intermedio',
   '¿Cuál es la pendiente de la recta que pasa por (1,1) y (3,7)?',
   '["2","3","6","1/3"]', '3', 'm = (7 − 1)/(3 − 1) = 3', 'prof.perez');
```

- `tipo = 'test'` (con `mundo_id` y **sin** `nodo_id`) para el test final del mundo.
- `correcta` tiene que ser **idéntica** a una de las alternativas.
- Se puede usar LaTeX entre `$...$` en enunciado, alternativas y explicación.

---

## 🔌 API del backend

Todo bajo `/api` en producción (Nginx lo quita antes de llegar a NestJS). Todas las rutas, salvo las de login, requieren la cookie `accessToken`.

<details>
<summary><b>Autenticación</b> — <code>/auth</code></summary>

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/auth/google` | Inicia el login con Google |
| GET | `/auth/google/callback` | Vuelta de Google, deja la cookie y redirige a `/auth/callback` |
| GET | `/auth/profile` | Usuario actual + `chatbot_habilitado` |
| POST | `/auth/signout` | Cierra sesión |
</details>

<details>
<summary><b>Chatbot</b> — <code>/v1/ai</code> · <code>/v1/chats</code> (requieren chatbot habilitado)</summary>

| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/v1/ai/answer` | Pregunta al tutor |
| GET | `/v1/ai/videos` | Videos por tema |
| POST | `/v1/ai/evaluate-concepto` · `evaluate-vof` · `evaluate-error` | Corrige ejercicios del panel |
| POST | `/v1/ai/save-exercise-result` | Guarda el resultado en `nivel_usuario` |
| GET / POST | `/v1/chats` | Lista / crea chats (máx. 6) |
| GET / PATCH / DELETE | `/v1/chats/:id` | Ver / renombrar / borrar |
| GET / POST | `/v1/chats/:id/hilos` | Historial / agregar mensaje |
| PUT | `/v1/chats/:id/reinforcement` · `/last-videos` | Guarda panel y videos |
| PATCH | `/v1/chats/:id/hilos/:hiloId/ejercicio` | Respuesta del alumno a un ejercicio |
</details>

<details>
<summary><b>Perfil y ranking</b></summary>

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/v1/profile/stats` | Estadísticas y puntos a reforzar |
| GET | `/v1/leaderboard?sort=&limit=` | Ranking general |
| GET | `/v1/leaderboard?tema=` · `/v1/leaderboard/top-temas` | Ranking por tema |
| GET / PUT | `/v1/users/me` | Datos del usuario |
</details>

<details>
<summary><b>Nivelación</b> — <code>/v1/nivelacion</code></summary>

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/estado` | Estudiante (nivel, XP), mundos, último análisis |
| GET | `/mundos/:id` | Nodos del mundo y estado del test |
| GET / POST | `/nodos/:id/fase` | Pide / responde una fase |
| GET / POST | `/mundos/:id/test` | Pide / responde el test (devuelve `chatbot_desbloqueado`) |
| POST | `/nodos/:id/entrenar` | Genera una pregunta de entrenamiento |
| POST | `/entrenar/:id` | Responde la pregunta generada |
| GET | `/analisis` | Último análisis del agente |
</details>

---

## 🎨 Frontend: estética y navegación

### Tokens de diseño

Todos los colores son variables CSS en `src/styles.scss`: `:root` para claro y `html[data-theme='dark']` para oscuro. Ninguna pantalla usa colores fijos, así que el modo claro/oscuro funciona en todas.

| Token | Uso |
|---|---|
| `--bg`, `--bg-panel`, `--bg-elev`, `--bg-soft` | Fondos (los paneles usan vidrio con `backdrop-filter`) |
| `--text`, `--text-2`, `--text-3` | Texto principal → secundario → tenue |
| `--accent`, `--accent-2`, `--accent-gradient` | Violeta → rosado de Axiomante |
| `--success`, `--warning`, `--error` (+ `-soft`) | Estados |

- `ThemeService` guarda la elección en `localStorage['axi-tema']` (oscuro por defecto). Un script en `index.html` aplica el tema **antes** de que arranque Angular, para que no parpadee.
- Fuente: **Outfit** · Íconos: Material Icons · Fórmulas: KaTeX (`katex-render.pipe.ts`).

### Navegación

```mermaid
flowchart LR
    L[/login/] --> CB[/auth/callback/]
    CB -- 1ª vez del día --> I[/inicio<br/>elegir módulo/]
    CB -- ya entró hoy --> APP[/app/]
    I --> APP
    I --> NIV[/nivelacion/]
    APP -- chatbotGuard: no habilitado --> NIV
    NIV -- botón Chatbot<br/>(🔒 si no habilitado) --> APP
    APP -- menú Nivelación --> NIV
```

### Pantalla del chat

- 3 columnas: **Mis chats** · conversación · **Pensamiento crítico**.
- Ambos laterales se **pliegan** a una barra de 64 px (flecha `‹ ›`), y la preferencia se recuerda por navegador (`axi-chats-plegado`, `axi-reinf-plegado`):
  - Mis chats plegado → círculos con la inicial de cada chat (tooltip con el nombre) + botón `+`.
  - Pensamiento crítico plegado → ícono con contador de ejercicios pendientes; naranja y pulsando si el chat está bloqueado.
- En celular (≤ 1100 px) los paneles son cajones laterales con botones flotantes.

---

## ⚙️ Variables de entorno

### `deploy/.env` (producción)

| Variable | Ejemplo / nota |
|---|---|
| `DOMINIO` | `axiomante.icb.udp.cl` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `icb_user` / *secreto* / `icb_chatbot` |
| `MONGO_USER` / `MONGO_PASSWORD` / `MONGO_DB` | `icb_user` / *secreto* / `icb_chatbot` |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | `sk-…` / `gpt-4.1-mini` |
| `INTERNAL_SECRET` | Secreto compartido backend ↔ agents |
| `JWT_SECRET` / `JWT_EXPIRES` | *secreto* / `7d` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Cliente OAuth de Google Cloud |
| `ALLOWED_DOMAIN` | `mail.udp.cl` |
| `PYTHON_TIMEOUT_MS` | `90000` |

### Desarrollo

- `chatbot-icb-backend-main/.env`: `DATABASE_URL`, `MONGO_URL`, `GOOGLE_*`, `GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback`, `FRONTEND_URL=http://localhost:4200`, `PYTHON_BASE_URL=http://localhost:8000`, `PYTHON_INTERNAL_SECRET`.
- `chatbot-icb-agents-service-main/.env`: `OPENAI_API_KEY`, `OPENAI_MODEL`, `DATABASE_URL`, `MONGO_URL`, `MONGO_DB`, `INTERNAL_SECRET`.
- `chatbot-icb-frontend-main/src/environments/environment.ts`: `API_URL: '/api'`, `AGENTS_URL: '/api/v1'`, `dev.selectorModulos`.

> 🔒 Los `.env`, `antes-migracion.env` y `firebase-credentials.json` están en `.gitignore`. **Nunca los subas.**

---

## 🩺 Problemas comunes

| Síntoma | Causa | Solución |
|---|---|---|
| `password authentication failed for user "icb_user"` | Hay un Postgres instalado en Windows ocupando el 5432 | El compose de desarrollo usa **55432**; revisa que los `.env` apunten ahí |
| `redirect_uri_mismatch` en Google | La URI no está autorizada | Agrega la URI exacta en el cliente OAuth (local o `https://DOMINIO/api/auth/google/callback`) |
| Login OK pero "no autorizado" | El correo no está en `whitelist_alumnos` o `activo = false` | `INSERT`/`UPDATE` en `whitelist_alumnos` |
| `Error code: 401 … Incorrect API key` al preguntar | Key de OpenAI inválida o revocada | Cambia `OPENAI_API_KEY` y reinicia agents |
| El alumno cae siempre en Nivelación | `chatbot_habilitado = false` | Es lo esperado para alumnos nuevos; ver [Gestión de alumnos](#-gestión-de-alumnos-sql-listo-para-copiar) |
| El panel de pensamiento crítico nunca llega | Agents caído o `INTERNAL_SECRET` distinto en backend y agents | `docker compose logs agents` y compara los secretos |
| El script `.ps1` se corta en Windows | Política de ejecución | `powershell -ExecutionPolicy Bypass -File …` |
| Fórmula en rojo tipo `\nf` | Bug del renderizador (ya corregido) | Actualiza a la última versión de la rama |

---

## ✅ Checklist antes de producción

- [ ] Dominio y certificado en `deploy/nginx/certs/`
- [ ] Redirect URI de producción autorizada en Google
- [ ] `deploy/.env` con secretos **nuevos** (no los de desarrollo)
- [ ] `nivelacion.sql` aplicado y alumnos nuevos cargados con su `nivel_inicial`
- [ ] Banco de preguntas revisado por los profesores
- [ ] Decidir si se mantiene `dev.selectorModulos` (pantalla `/inicio` y acceso a Nivelación desde el menú del chatbot)
- [ ] Revisar que `Credenciales.txt` no tenga claves reales (está versionado)
- [ ] Respaldo programado de Postgres y Mongo
- [ ] Probar login, una pregunta, un ejercicio y una fase de nivelación con una cuenta real

---

## 👥 Equipo

| Persona | Rol |
|---|---|
| **Dante Libiot** | Arquitectura · Backend · Agentes IA · BD |
| **Rodrigo Jeria** | Frontend · Diseño · Datos · Cloud |

<div align="center"><sub>Hecho para el Instituto de Ciencias Básicas — Universidad Diego Portales ✦</sub></div>
