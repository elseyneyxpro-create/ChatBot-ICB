-- ============================================================================
-- Migración: mapa antiguo de la maqueta (4 mundos × 10 nodos) → mapa del cuaderno
-- (5 mundos, 26 nodos). Correr UNA vez en una base que ya tenga el mapa antiguo,
-- y después volver a aplicar nivelacion.sql, que carga el mapa nuevo:
--
--   docker compose exec -T postgres psql -U icb_user -d icb_chatbot < sql/migrar_mundos_cuaderno.sql
--   docker compose exec -T postgres psql -U icb_user -d icb_chatbot < sql/nivelacion.sql
--
-- Qué borra (solo si encuentra los 4 mundos antiguos):
--   - los mundos y nodos antiguos,
--   - las preguntas de test de la maqueta asociadas a esos mundos,
--   - el avance por nodo y por test de los alumnos en ese mapa (no sirve en el nuevo).
-- Qué conserva:
--   - el historial de respuestas (niv_progreso.intento, queda sin mundo/nodo),
--   - nivel y XP de cada alumno, los análisis del agente y las preguntas generales.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  antiguos int;
BEGIN
  SELECT count(*) INTO antiguos FROM niv_banco.mundo
   WHERE titulo IN ('Funciones Lineales', 'Funciones Cuadráticas', 'Conceptos de Geometría', 'Aplicaciones del Mundo Real');
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
