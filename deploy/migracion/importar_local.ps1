<#
  Importa los datos REALES de Supabase y Firestore a las bases locales de tu PC
  (las de deploy\docker-compose.dev.yml) para probar el chatbot con datos de verdad.

  Requisitos: Docker Desktop corriendo y Python instalado.

  Uso (PowerShell, desde la carpeta deploy\migracion):
    .\importar_local.ps1 -SupabaseDbUrl "postgresql://postgres.XXXX:CLAVE@aws-0-REGION.pooler.supabase.com:5432/postgres" `
                         -FirebaseCred "C:\ruta\firebase-credentials.json"

  Si PowerShell bloquea el script:  powershell -ExecutionPolicy Bypass -File .\importar_local.ps1 ...
#>
param(
  [Parameter(Mandatory = $true)][string]$SupabaseDbUrl,
  [Parameter(Mandatory = $true)][string]$FirebaseCred,
  [switch]$SoloPostgres,
  [switch]$SoloMongo
)
# "Continue": en Windows PowerShell, si un comando externo (docker, pg_dump...) escribe en stderr
# con "Stop" el script se corta aunque no haya error. Revisamos $LASTEXITCODE a mano.
$ErrorActionPreference = "Continue"
$deploy  = Split-Path $PSScriptRoot -Parent
$compose = Join-Path $deploy "docker-compose.dev.yml"
function DC { docker compose -f $compose @args; if ($LASTEXITCODE -ne 0) { throw "Fallo un comando de docker compose (revisa el mensaje justo arriba)" } }
function PSQL([string]$sql) { DC exec -T postgres psql -U icb_user -d icb_chatbot -v ON_ERROR_STOP=1 -c $sql }

Write-Host "== 1) Levantando Postgres + Mongo locales" -ForegroundColor Cyan
DC up -d
Write-Host "   Esperando a que Postgres este listo..."
$listo = $false
for ($i = 0; $i -lt 45; $i++) {
  docker compose -f $compose exec -T postgres pg_isready -U icb_user -d icb_chatbot 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { $listo = $true; break }
  Start-Sleep 2
}
if (-not $listo) { throw "Postgres no partio. Revisa: docker compose -f `"$compose`" logs postgres" }
Write-Host "   Postgres listo."

if (-not $SoloMongo) {
  Write-Host "== 2) Supabase -> Postgres local" -ForegroundColor Cyan
  $vecSchema = docker compose -f $compose exec -T postgres psql $SupabaseDbUrl -At -c "SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'vector'"
  if ($LASTEXITCODE -ne 0) { throw "No se pudo conectar a Supabase. Revisa la URI y la clave (ver mensaje arriba)." }
  $vecSchema = "$vecSchema".Trim()
  if (-not $vecSchema) { $vecSchema = "public" }
  Write-Host "   pgvector esta en el schema: $vecSchema"

  Write-Host "   Haciendo dump (puede tardar un poco)..."
  # El dump se guarda DENTRO del contenedor para no pasar binarios por PowerShell
  DC exec -T postgres pg_dump $SupabaseDbUrl --schema=public --no-owner --no-privileges -Fc -f /tmp/supabase_public.dump

  Write-Host "   Preparando la base local..."
  PSQL "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
  PSQL "DO `$`$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF; END `$`$;"
  PSQL "CREATE SCHEMA IF NOT EXISTS auth; CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid'; CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS 'SELECT NULL::text';"
  PSQL "CREATE SCHEMA IF NOT EXISTS $vecSchema; CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA $vecSchema; ALTER DATABASE icb_chatbot SET search_path = public, $vecSchema;"

  Write-Host "   Restaurando..."
  docker compose -f $compose exec -T postgres pg_restore -U icb_user -d icb_chatbot --no-owner --no-privileges /tmp/supabase_public.dump
  if ($LASTEXITCODE -ne 0) { Write-Host "   (pg_restore mostro advertencias; revisalas arriba. 'schema public already exists' es normal)" -ForegroundColor Yellow }

  Write-Host "   Filas importadas:"
  PSQL "SELECT 'tema' AS tabla, count(*) FROM tema UNION ALL SELECT 'contenido_tema', count(*) FROM contenido_tema UNION ALL SELECT 'videos', count(*) FROM videos UNION ALL SELECT 'usuario', count(*) FROM usuario UNION ALL SELECT 'whitelist_alumnos', count(*) FROM whitelist_alumnos;"
}

if (-not $SoloMongo) {
  Write-Host "== 2b) Tablas de la nivelacion (sql\nivelacion.sql)" -ForegroundColor Cyan
  DC cp (Join-Path $deploy "sql\nivelacion.sql") postgres:/tmp/nivelacion.sql
  DC exec -T postgres psql -U icb_user -d icb_chatbot -v ON_ERROR_STOP=1 -q -f /tmp/nivelacion.sql
}

if (-not $SoloPostgres) {
  Write-Host "== 3) Firestore -> Mongo local" -ForegroundColor Cyan
  python -m pip install --quiet firebase-admin pymongo
  if ($LASTEXITCODE -ne 0) { throw "No se pudo instalar firebase-admin/pymongo con pip" }
  python (Join-Path $PSScriptRoot "02_firestore_a_mongo.py") --cred $FirebaseCred --mongo "mongodb://localhost:27017" --db icb_chatbot
  if ($LASTEXITCODE -ne 0) { throw "Fallo la importacion de Firestore" }
}

Write-Host "`nListo. Ahora levanta agents, backend y frontend (ver deploy\README.md, seccion 'Probar en tu PC')." -ForegroundColor Green
