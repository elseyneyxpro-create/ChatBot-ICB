-- ============================================================================
-- Migración: mapa antiguo de la maqueta (4 mundos × 10 nodos) → mapa del cuaderno
-- (5 mundos, 26 nodos). Correr UNA vez en una base que ya tenga el mapa antiguo,
-- y después volver a aplicar nivelacion.sql, que carga el mapa nuevo:
--
--   docker compose cp sql/migrar_mundos_cuaderno.sql postgres:/tmp/migrar.sql
--   docker compose exec postgres psql -U icb_user -d icb_chatbot -f /tmp/migrar.sql
--   (y después nivelacion.sql de la misma forma; ver su encabezado)
-- NO usar "Get-Content ... | psql" en PowerShell: cambia la codificación y rompe las tildes.
--
-- Qué borra (solo si encuentra los 4 mundos antiguos):
--   - los mundos y nodos antiguos,
--   - las preguntas de test de la maqueta asociadas a esos mundos,
--   - el avance por nodo y por test de los alumnos en ese mapa (no sirve en el nuevo).
-- Qué conserva:
--   - el historial de respuestas (niv_progreso.intento, queda sin mundo/nodo),
--   - nivel y XP de cada alumno, los análisis del agente y las preguntas generales.
-- ============================================================================
SET client_encoding = 'UTF8';
BEGIN;

DO $$
DECLARE
  antiguos int;
BEGIN
  SELECT count(*) INTO antiguos FROM niv_banco.mundo
   -- Con comodines en las tildes: reconoce el mapa antiguo aunque se haya cargado con las tildes dañadas
   WHERE titulo LIKE ANY (ARRAY['Funciones Lineales', 'Funciones Cuadr%ticas', 'Conceptos de Geometr%a', 'Aplicaciones del Mundo Real']);
  IF antiguos = 0 THEN
    RAISE NOTICE 'No está el mapa antiguo: no se borra nada.';
    RETURN;
  END IF;
  IF antiguos < (SELECT count(*) FROM niv_banco.mundo) THEN
    RAISE EXCEPTION 'Hay mundos que no son del mapa antiguo. Revisa niv_banco.mundo antes de migrar.';
  END IF;

  -- ON DELETE CASCADE: nodos, preguntas del mundo, progreso_nodo y progreso_test.
  -- ON DELETE SET NULL: intento.mundo_id / intento.nodo_id (el historial se conserva).
  DELETE FROM niv_banco.mundo;
  RAISE NOTICE 'Mapa antiguo borrado (% mundos). Ahora aplica nivelacion.sql.', antiguos;
END $$;

COMMIT;
