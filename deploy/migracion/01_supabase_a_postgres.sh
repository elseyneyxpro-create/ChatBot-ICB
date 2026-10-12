#!/usr/bin/env bash
# Copia las tablas de Supabase (schema public: tema, contenido_tema, videos, usuario,
# whitelist_alumnos, función match_contenido, etc.) al Postgres de la VM.
#
# Uso (en la VM, con docker compose ya levantado, desde deploy/):
#   SUPABASE_DB_URL='postgresql://postgres.<ref>:<clave>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
#     bash migracion/01_supabase_a_postgres.sh
#
# SUPABASE_DB_URL: Supabase → Project Settings → Database → Connection string (URI, "Session pooler").
# Los embeddings viajan tal cual; no hay que regenerarlos.
set -euo pipefail
cd "$(dirname "$0")/.."
source .env
: "${SUPABASE_DB_URL:?Define SUPABASE_DB_URL}"

PG="docker compose exec -T postgres"
DUMP=migracion/supabase_public.dump

echo "1) ¿En qué schema está pgvector en Supabase?"
VEC_SCHEMA=$($PG psql "$SUPABASE_DB_URL" -At -c \
  "SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'vector'")
VEC_SCHEMA=${VEC_SCHEMA:-public}
echo "   → $VEC_SCHEMA"

echo "2) Dump del schema public de Supabase (sin dueños ni permisos)..."
$PG pg_dump "$SUPABASE_DB_URL" --schema=public --no-owner --no-privileges -Fc > "$DUMP"
ls -lh "$DUMP"

echo "3) Preparando la base local (roles/esquemas que Supabase referencia en políticas RLS)..."
$PG psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')  THEN CREATE ROLE service_role NOLOGIN; END IF;
END \$\$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid';
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS 'SELECT NULL::text';
CREATE SCHEMA IF NOT EXISTS ${VEC_SCHEMA};
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA ${VEC_SCHEMA};
ALTER DATABASE ${POSTGRES_DB} SET search_path = public, ${VEC_SCHEMA};
SQL

echo "4) Restaurando en el Postgres de la VM..."
docker compose cp "$DUMP" postgres:/tmp/supabase_public.dump
$PG pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges /tmp/supabase_public.dump || \
  echo "   (pg_restore reportó advertencias; revisa arriba. Errores de 'schema public already exists' son normales)"

echo "5) Conteo de filas:"
$PG psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
  SELECT 'tema' t, count(*) FROM tema UNION ALL
  SELECT 'contenido_tema', count(*) FROM contenido_tema UNION ALL
  SELECT 'videos', count(*) FROM videos UNION ALL
  SELECT 'usuario', count(*) FROM usuario UNION ALL
  SELECT 'whitelist_alumnos', count(*) FROM whitelist_alumnos;"
$PG psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\df match_contenido"
echo "6) Tablas de la nivelación..."
docker compose cp sql/nivelacion.sql postgres:/tmp/nivelacion.sql
$PG psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q -f /tmp/nivelacion.sql
echo "Listo."
