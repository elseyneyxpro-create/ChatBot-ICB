# Despliegue en la VM de la universidad

Todo corre con Docker Compose en un solo servidor. Solo se expone el **puerto 443**.

```
Internet ──443──▶ nginx ──/──────▶ Angular (archivos estáticos)
                      └──/api/──▶ backend NestJS :3000 ──▶ agents (FastAPI) :8000
                                        │                       │
                                        ├──▶ postgres (pgvector) ◀┤   ← antes Supabase
                                        └──▶ mongo               ◀┘   ← antes Firestore
```

## Qué cambió respecto a la versión en la nube

| Antes | Ahora |
|---|---|
| Supabase Auth (login Google) + Firebase Auth (custom token) | Login Google directo en NestJS (`/api/auth/google`), sesión en cookie `accessToken` |
| Supabase (tablas + `match_contenido`) | PostgreSQL 17 + pgvector, mismas tablas y función |
| Firestore (el **frontend** escribía directo) | MongoDB; el frontend usa endpoints del backend: `/api/v1/chats`, `/api/v1/profile/stats`, `/api/v1/leaderboard` |
| `onSnapshot` para esperar el reinforcement | Polling cada 2 s a `GET /api/v1/chats/:id` |
| El frontend mandaba el `uid` en el body | El backend lo toma del JWT y valida que el chat sea del usuario |
| `Perfil_usuario/{uid}/nivel_usuario/{tema}` (subcolección) | Colección plana `nivel_usuario` con `{ uid, tema, ... }` |

## Pasos

1. **Dominio + certificado.** Google OAuth no acepta IPs. Pide a TI un nombre (ej. `chatbot.xxx.udp.cl`)
   y su certificado; deja `fullchain.pem` y `privkey.pem` en `deploy/nginx/certs/`.
2. **Google Cloud Console** → Credenciales → tu ID de cliente OAuth → agrega la URI de redirección
   `https://DOMINIO/api/auth/google/callback` (y para pruebas locales `http://localhost:3000/auth/google/callback`).
3. `cp .env.example .env` y completa los valores.
4. `docker compose up -d --build`
5. **Migrar Supabase → Postgres:**
   `SUPABASE_DB_URL='postgresql://...' bash migracion/01_supabase_a_postgres.sh`
6. **Migrar Firestore → Mongo** (desde tu PC con un túnel SSH al 27017, o en la VM):
   `python migracion/02_firestore_a_mongo.py --cred firebase-credentials.json --mongo "mongodb://USER:PASS@localhost:27017/?authSource=admin"`
7. `docker compose restart backend agents` y entra a `https://DOMINIO`.

Los usuarios mantienen su historial: al hacer login se busca su correo en la tabla `usuario`
(migrada desde Supabase) y se reutiliza su `id_user`, que es el mismo uid que tenían en Firestore.

## Probar en tu PC con datos reales (Windows)

Necesitas: Docker Desktop, Python, Node, y estas credenciales:
- **Supabase**: Project Settings → Database → Connect → *Session pooler* (URI con la clave de la base).
- **Firebase**: Configuración del proyecto → Cuentas de servicio → *Generar nueva clave privada* (JSON).
  Guárdalo como `deploy/migracion/firebase-credentials.json` (está en .gitignore).

1. Importar las dos bases (PowerShell, en `deploy\migracion`):
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\importar_local.ps1 -SupabaseDbUrl "postgresql://..." -FirebaseCred ".\firebase-credentials.json"
   ```
2. Tres terminales:
   ```powershell
   cd chatbot-icb-agents-service-main; pip install -r requirements.txt; uvicorn app.main:app --reload --port 8000
   cd chatbot-icb-backend-main; npm install; npm run start:dev
   cd chatbot-icb-frontend-main; npm install; npm start
   ```
3. Abrir http://localhost:4200 y entrar con Google (cuenta @mail.udp.cl que esté en `whitelist_alumnos`).

Los `.env` de backend y agents ya apuntan a `localhost` (Postgres :55432, Mongo :27017).
El login usa `GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback`: esa URI tiene que estar
autorizada en el cliente OAuth de Google Cloud Console.

## Nivelación

Módulo "hermano" del chatbot: mismos usuarios y login, tablas propias en Postgres (`deploy/sql/nivelacion.sql`).

| Esquema | Qué guarda |
|---|---|
| `niv_banco` | Preguntas **base de los profesores**: `mundo` → `nodo` → `pregunta` (alternativas, correcta, dificultad, tipo `nodo`/`test`) |
| `niv_progreso` | Avance del alumno: `estudiante` (nivel, XP), `progreso_nodo`, `progreso_test`, `intento` (cada respuesta), `analisis` (agente) |
| `whitelist_alumnos` | (tabla existente) + columna `chatbot_habilitado` |

- **Fases de nodo y test** usan solo preguntas del banco. La corrección es en el servidor.
- **Modo Entrenar**: el agente generador crea preguntas nuevas; **no se guardan en el banco**, solo como
  `intento` con `origen = 'generada'` (suman XP y alimentan al analista).
- **Agente analista**: después de cada fase/test y cada 5 entrenamientos revisa los últimos intentos,
  guarda `fortalezas/debilidades/recomendación` y ajusta el nivel del alumno.

### Quién puede usar el chatbot

Columnas en la tabla de alumnos `whitelist_alumnos`:

- `nivel_inicial` (Principiante/Intermedio/Avanzado): lo asignan los profesores. El alumno **no** elige su nivel; parte con este y el agente analista lo va ajustando.
- `chatbot_habilitado` (0/1):

- **Alumnos antiguos** (los que ya estaban al aplicar `nivelacion.sql`) → `true`: siguen usando el chatbot.
- **Alumnos nuevos** (cualquier `INSERT` posterior) → `false` por defecto: solo ven la nivelación.
- Al **completar todos los mundos**, el backend la pasa a `true` automáticamente.

```sql
-- Cargar alumnos nuevos con el NIVEL INICIAL que definen los profesores
-- (quedan con chatbot_habilitado = false; si no se indica nivel, parten en 'Principiante')
INSERT INTO whitelist_alumnos (email, activo, nivel_inicial) VALUES
  ('alumno1@mail.udp.cl', true, 'Intermedio'),
  ('alumno2@mail.udp.cl', true, 'Principiante');

-- Habilitar o bloquear a mano
UPDATE whitelist_alumnos SET chatbot_habilitado = true  WHERE lower(email) = 'alumno1@mail.udp.cl';
UPDATE whitelist_alumnos SET chatbot_habilitado = false WHERE lower(email) = 'alumno2@mail.udp.cl';

-- Ver quiénes están pendientes
SELECT email FROM whitelist_alumnos WHERE activo AND NOT chatbot_habilitado;
```

### Agregar preguntas de los profesores

```sql
INSERT INTO niv_banco.pregunta (mundo_id, nodo_id, tipo, dificultad, enunciado, alternativas, correcta, explicacion, creado_por)
VALUES (1, (SELECT id FROM niv_banco.nodo WHERE mundo_id = 1 AND orden = 1), 'nodo', 'Intermedio',
        '¿Cuál es la pendiente de la recta que pasa por (1,1) y (3,7)?', '["2","3","6","1/3"]', '3',
        'm = (7 − 1)/(3 − 1) = 3', 'prof.perez');
```
`tipo = 'test'` (con `mundo_id`, sin `nodo_id`) para el test final del mundo. `correcta` debe ser idéntica a una alternativa.

## Comandos útiles

```bash
docker compose logs -f backend agents     # ver logs
docker compose exec postgres psql -U icb_user -d icb_chatbot
docker compose exec mongo mongosh -u icb_user -p
```
