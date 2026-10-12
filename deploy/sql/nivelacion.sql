-- ============================================================================
-- NIVELACIÓN (Axiomante) — esquema de base de datos
--
--   niv_banco    → preguntas BASE que definen los profesores (mundos, nodos, preguntas)
--   niv_progreso → avance de cada alumno: nivel, XP, fases, intentos y análisis del agente
--
-- Las preguntas GENERADAS por IA (modo Entrenar) NO se guardan en niv_banco:
-- solo quedan registradas como intentos en niv_progreso.intento (origen = 'generada').
--
-- Idempotente: se puede correr varias veces.
--   docker compose exec -T postgres psql -U icb_user -d icb_chatbot < sql/nivelacion.sql
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS niv_banco;
CREATE SCHEMA IF NOT EXISTS niv_progreso;

-- ─── Banco de preguntas (profesores) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS niv_banco.mundo (
  id          serial PRIMARY KEY,
  orden       int  NOT NULL UNIQUE,
  titulo      text NOT NULL,
  descripcion text,
  icono       text,                         -- nombre de ícono Material (ej. trending_up)
  activo      boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS niv_banco.nodo (
  id          serial PRIMARY KEY,
  mundo_id    int  NOT NULL REFERENCES niv_banco.mundo(id) ON DELETE CASCADE,
  orden       int  NOT NULL,
  titulo      text NOT NULL,                -- tema/habilidad (lo usa el generador de preguntas)
  descripcion text,
  UNIQUE (mundo_id, orden)
);

CREATE TABLE IF NOT EXISTS niv_banco.pregunta (
  id           serial PRIMARY KEY,
  mundo_id     int REFERENCES niv_banco.mundo(id) ON DELETE CASCADE, -- NULL = sirve para cualquier mundo
  nodo_id      int REFERENCES niv_banco.nodo(id)  ON DELETE CASCADE, -- NULL = sirve para cualquier nodo del mundo
  tipo         text NOT NULL CHECK (tipo IN ('nodo', 'test')),
  fase_test    int  CHECK (fase_test IN (1, 2)),                      -- solo tipo='test'; NULL = ambas fases
  dificultad   text NOT NULL CHECK (dificultad IN ('Principiante', 'Intermedio', 'Avanzado')),
  enunciado    text NOT NULL,
  alternativas jsonb NOT NULL,                                        -- ["a", "b", "c", "d"]
  correcta     text NOT NULL,                                         -- debe ser una de las alternativas
  explicacion  text,
  activa       boolean NOT NULL DEFAULT true,
  creado_por   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT correcta_en_alternativas CHECK (alternativas ? correcta)
);
CREATE INDEX IF NOT EXISTS pregunta_busqueda_idx ON niv_banco.pregunta (tipo, dificultad, mundo_id, nodo_id) WHERE activa;

-- ─── Progreso de los alumnos ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS niv_progreso.estudiante (
  uid                text PRIMARY KEY,      -- = usuario.id_user (mismo uid del chatbot)
  correo             text,
  nivel              text CHECK (nivel IN ('Principiante', 'Intermedio', 'Avanzado')), -- parte en whitelist_alumnos.nivel_inicial; lo ajusta el analista
  xp                 int  NOT NULL DEFAULT 0,
  entrenamientos     int  NOT NULL DEFAULT 0,  -- respuestas en modo Entrenar (para disparar el análisis)
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ─── Acceso al chatbot: columna en la tabla de alumnos que ya existe ─────────
-- whitelist_alumnos.chatbot_habilitado:
--   true  (1) → puede usar el chatbot (alumnos antiguos, o nuevos que completaron la nivelación)
--   false (0) → solo ve la nivelación (alumnos nuevos)
-- Truco: la columna se crea con DEFAULT true para que TODOS los alumnos que ya existen queden
-- habilitados, y luego el default pasa a false para que cada alumno NUEVO que se inserte parta bloqueado.
-- Al completar todos los mundos, el backend la pasa a true automáticamente.
DO $$
BEGIN
  IF to_regclass('public.whitelist_alumnos') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = 'whitelist_alumnos'
                        AND column_name = 'chatbot_habilitado') THEN
    ALTER TABLE public.whitelist_alumnos ADD COLUMN chatbot_habilitado boolean NOT NULL DEFAULT true;
    ALTER TABLE public.whitelist_alumnos ALTER COLUMN chatbot_habilitado SET DEFAULT false;
  END IF;
END $$;

-- Nivel inicial de cada alumno: lo definen los PROFESORES al cargar los alumnos.
-- Desde ahí el agente analista lo va ajustando según sus respuestas (niv_progreso.estudiante.nivel).
-- Si no se especifica, parte en 'Principiante'.
DO $$
BEGIN
  IF to_regclass('public.whitelist_alumnos') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = 'whitelist_alumnos'
                        AND column_name = 'nivel_inicial') THEN
    ALTER TABLE public.whitelist_alumnos
      ADD COLUMN nivel_inicial text NOT NULL DEFAULT 'Principiante'
      CHECK (nivel_inicial IN ('Principiante', 'Intermedio', 'Avanzado'));
  END IF;
END $$;

-- (versión anterior usaba una tabla aparte; ya no se usa)
DROP TABLE IF EXISTS niv_progreso.chatbot_habilitado;

CREATE TABLE IF NOT EXISTS niv_progreso.progreso_nodo (
  uid        text NOT NULL REFERENCES niv_progreso.estudiante(uid) ON DELETE CASCADE,
  nodo_id    int  NOT NULL REFERENCES niv_banco.nodo(id) ON DELETE CASCADE,
  fases      int  NOT NULL DEFAULT 0 CHECK (fases BETWEEN 0 AND 4),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (uid, nodo_id)
);

CREATE TABLE IF NOT EXISTS niv_progreso.progreso_test (
  uid            text NOT NULL REFERENCES niv_progreso.estudiante(uid) ON DELETE CASCADE,
  mundo_id       int  NOT NULL REFERENCES niv_banco.mundo(id) ON DELETE CASCADE,
  fase           int  NOT NULL DEFAULT 0 CHECK (fase BETWEEN 0 AND 2), -- 2 = mundo completado
  mejor_puntaje  int  NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (uid, mundo_id)
);

-- Cada respuesta del alumno (banco o generada). El enunciado se copia para conservar
-- el registro aunque la pregunta del banco cambie o la generada no exista en ningún lado.
CREATE TABLE IF NOT EXISTS niv_progreso.intento (
  id           bigserial PRIMARY KEY,
  uid          text NOT NULL REFERENCES niv_progreso.estudiante(uid) ON DELETE CASCADE,
  origen       text NOT NULL CHECK (origen IN ('banco', 'generada')),
  contexto     text NOT NULL CHECK (contexto IN ('fase', 'test', 'entrenar')),
  pregunta_id  int REFERENCES niv_banco.pregunta(id) ON DELETE SET NULL,
  mundo_id     int REFERENCES niv_banco.mundo(id) ON DELETE SET NULL,
  nodo_id      int REFERENCES niv_banco.nodo(id)  ON DELETE SET NULL,
  dificultad   text,
  enunciado    text NOT NULL,
  alternativas jsonb,
  respuesta    text,
  correcta     text,
  es_correcto  boolean NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intento_uid_idx ON niv_progreso.intento (uid, created_at DESC);

-- Lo que concluye el agente analista (historial completo).
CREATE TABLE IF NOT EXISTS niv_progreso.analisis (
  id             bigserial PRIMARY KEY,
  uid            text NOT NULL REFERENCES niv_progreso.estudiante(uid) ON DELETE CASCADE,
  nivel_sugerido text,
  fortalezas     jsonb NOT NULL DEFAULT '[]',
  debilidades    jsonb NOT NULL DEFAULT '[]',
  recomendacion  text,
  resumen        text,
  n_intentos     int,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analisis_uid_idx ON niv_progreso.analisis (uid, created_at DESC);

-- ─── Seed inicial (preguntas de la maqueta C:\Propuesta) ───────────────────
-- Los títulos de los nodos son una propuesta: los profesores pueden cambiarlos.
-- Las preguntas de 'nodo' sin mundo son generales, para practicar mientras los
-- profesores cargan las propias de cada nodo.
INSERT INTO niv_banco.mundo (id, orden, titulo, icono) VALUES (1, 1, 'Funciones Lineales', 'trending_up') ON CONFLICT (id) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (1, 1, 'Pendiente de una recta') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (1, 2, 'Intercepto con los ejes') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (1, 3, 'Forma pendiente-intercepto') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (1, 4, 'Forma general de la recta') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (1, 5, 'Recta que pasa por dos puntos') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (1, 6, 'Rectas paralelas y perpendiculares') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (1, 7, 'Gráfica de una función lineal') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (1, 8, 'Ecuaciones lineales') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (1, 9, 'Sistemas de ecuaciones 2x2') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (1, 10, 'Modelación con funciones lineales') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.mundo (id, orden, titulo, icono) VALUES (2, 2, 'Funciones Cuadráticas', 'show_chart') ON CONFLICT (id) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (2, 1, 'Forma estándar ax²+bx+c') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (2, 2, 'Raíces por factorización') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (2, 3, 'Fórmula general') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (2, 4, 'Discriminante') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (2, 5, 'Vértice de la parábola') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (2, 6, 'Eje de simetría') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (2, 7, 'Forma canónica') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (2, 8, 'Gráfica de parábolas') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (2, 9, 'Inecuaciones cuadráticas') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (2, 10, 'Problemas de optimización') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.mundo (id, orden, titulo, icono) VALUES (3, 3, 'Conceptos de Geometría', 'change_history') ON CONFLICT (id) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (3, 1, 'Ángulos') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (3, 2, 'Triángulos') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (3, 3, 'Teorema de Pitágoras') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (3, 4, 'Perímetros') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (3, 5, 'Áreas de polígonos') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (3, 6, 'Círculo y circunferencia') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (3, 7, 'Volúmenes') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (3, 8, 'Semejanza de figuras') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (3, 9, 'Trigonometría básica') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (3, 10, 'Distancia en el plano cartesiano') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.mundo (id, orden, titulo, icono) VALUES (4, 4, 'Aplicaciones del Mundo Real', 'rocket_launch') ON CONFLICT (id) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (4, 1, 'Porcentajes') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (4, 2, 'Proporciones') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (4, 3, 'Velocidad y razones de cambio') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (4, 4, 'Interés simple') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (4, 5, 'Problemas de mezclas') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (4, 6, 'Modelos lineales aplicados') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (4, 7, 'Modelos cuadráticos aplicados') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (4, 8, 'Unidades y conversiones') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (4, 9, 'Lectura de gráficos') ON CONFLICT (mundo_id, orden) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo) VALUES (4, 10, 'Problemas mixtos') ON CONFLICT (mundo_id, orden) DO NOTHING;
SELECT setval(pg_get_serial_sequence('niv_banco.mundo','id'), GREATEST((SELECT max(id) FROM niv_banco.mundo), 1));
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT NULL, 'nodo', 'Principiante', 'Resuelve para x: x + 2 = 5', '["2", "3", "4", "5"]'::jsonb, '3', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Resuelve para x: x + 2 = 5' AND dificultad = 'Principiante' AND tipo = 'nodo');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT NULL, 'nodo', 'Principiante', 'Evalúa 2 + 3 · 2', '["10", "8", "7", "6"]'::jsonb, '8', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Evalúa 2 + 3 · 2' AND dificultad = 'Principiante' AND tipo = 'nodo');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT NULL, 'nodo', 'Principiante', 'Simplifica x + x', '["x²", "2x", "x", "0"]'::jsonb, '2x', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Simplifica x + x' AND dificultad = 'Principiante' AND tipo = 'nodo');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT NULL, 'nodo', 'Principiante', '¿Cuál es el valor de y si y = x + 1 y x = 3?', '["2", "3", "4", "5"]'::jsonb, '4', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Cuál es el valor de y si y = x + 1 y x = 3?' AND dificultad = 'Principiante' AND tipo = 'nodo');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT NULL, 'nodo', 'Intermedio', 'Resuelve para x: 3x = 12', '["2", "3", "4", "6"]'::jsonb, '4', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Resuelve para x: 3x = 12' AND dificultad = 'Intermedio' AND tipo = 'nodo');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT NULL, 'nodo', 'Intermedio', 'Evalúa 2² + 3²', '["10", "13", "25", "5"]'::jsonb, '13', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Evalúa 2² + 3²' AND dificultad = 'Intermedio' AND tipo = 'nodo');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT NULL, 'nodo', 'Intermedio', 'Simplifica 2(x + 3)', '["2x + 3", "2x + 6", "x + 6", "5x"]'::jsonb, '2x + 6', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Simplifica 2(x + 3)' AND dificultad = 'Intermedio' AND tipo = 'nodo');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT NULL, 'nodo', 'Intermedio', '¿Cuál es el valor de y si y = 2x − 1 y x = 3?', '["4", "5", "6", "7"]'::jsonb, '5', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Cuál es el valor de y si y = 2x − 1 y x = 3?' AND dificultad = 'Intermedio' AND tipo = 'nodo');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT NULL, 'nodo', 'Avanzado', 'Resuelve para x: 2x² − 8 = 0', '["2, −2", "4", "2", "0"]'::jsonb, '2, −2', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Resuelve para x: 2x² − 8 = 0' AND dificultad = 'Avanzado' AND tipo = 'nodo');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT NULL, 'nodo', 'Avanzado', 'Evalúa log₂(8) + 3²', '["10", "11", "12", "13"]'::jsonb, '12', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Evalúa log₂(8) + 3²' AND dificultad = 'Avanzado' AND tipo = 'nodo');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT NULL, 'nodo', 'Avanzado', 'Simplifica (x² − 9)/(x − 3)', '["x − 3", "x + 3", "x", "1"]'::jsonb, 'x + 3', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Simplifica (x² − 9)/(x − 3)' AND dificultad = 'Avanzado' AND tipo = 'nodo');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT NULL, 'nodo', 'Avanzado', '¿Cuál es la pendiente de 3y − 6x = 9?', '["2", "3", "6", "−2"]'::jsonb, '2', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Cuál es la pendiente de 3y − 6x = 9?' AND dificultad = 'Avanzado' AND tipo = 'nodo');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 1, 'test', 'Principiante', '¿Cuál es la intersección en y de y = x − 5?', '["1", "−5", "5", "0"]'::jsonb, '−5', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Cuál es la intersección en y de y = x − 5?' AND dificultad = 'Principiante' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 1, 'test', 'Principiante', 'Encuentra la pendiente de la recta que pasa por (0,0) y (2,4)', '["2", "4", "1/2", "0"]'::jsonb, '2', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Encuentra la pendiente de la recta que pasa por (0,0) y (2,4)' AND dificultad = 'Principiante' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 1, 'test', 'Principiante', '¿Qué ecuación representa una línea horizontal?', '["x = 5", "y = x", "y = 4", "y = 4x"]'::jsonb, 'y = 4', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Qué ecuación representa una línea horizontal?' AND dificultad = 'Principiante' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 1, 'test', 'Intermedio', '¿Cuál es la intersección en y de y = 3x − 5?', '["3", "−5", "5", "0"]'::jsonb, '−5', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Cuál es la intersección en y de y = 3x − 5?' AND dificultad = 'Intermedio' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 1, 'test', 'Intermedio', 'Encuentra la pendiente de la recta que pasa por (1,2) y (3,6)', '["2", "4", "1/2", "−2"]'::jsonb, '2', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Encuentra la pendiente de la recta que pasa por (1,2) y (3,6)' AND dificultad = 'Intermedio' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 1, 'test', 'Intermedio', '¿Cuál es la ecuación de la recta con m = 2 que pasa por (0,1)?', '["y = 2x + 1", "y = x + 2", "y = 2x", "y = 2"]'::jsonb, 'y = 2x + 1', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Cuál es la ecuación de la recta con m = 2 que pasa por (0,1)?' AND dificultad = 'Intermedio' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 1, 'test', 'Avanzado', 'Encuentra la pendiente de la recta 4x − 2y = 8', '["2", "4", "−2", "8"]'::jsonb, '2', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Encuentra la pendiente de la recta 4x − 2y = 8' AND dificultad = 'Avanzado' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 1, 'test', 'Avanzado', '¿Qué recta es perpendicular a y = 2x + 1?', '["y = −1/2 x", "y = 2x − 1", "y = −2x", "y = 1/2 x"]'::jsonb, 'y = −1/2 x', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Qué recta es perpendicular a y = 2x + 1?' AND dificultad = 'Avanzado' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 1, 'test', 'Avanzado', 'Encuentra la intersección con el eje x de 3y + 6x = 18', '["3", "6", "2", "0"]'::jsonb, '3', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Encuentra la intersección con el eje x de 3y + 6x = 18' AND dificultad = 'Avanzado' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 2, 'test', 'Principiante', 'Encuentra las raíces de x² − 4 = 0', '["x = 2, x = −2", "x = 4", "x = 0", "x = 2"]'::jsonb, 'x = 2, x = −2', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Encuentra las raíces de x² − 4 = 0' AND dificultad = 'Principiante' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 2, 'test', 'Principiante', '¿Cuál es el vértice de y = x²?', '["(1,1)", "(0,0)", "(−1,1)", "(0,1)"]'::jsonb, '(0,0)', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Cuál es el vértice de y = x²?' AND dificultad = 'Principiante' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 2, 'test', 'Principiante', '¿Hacia dónde abre la parábola y = x²?', '["Arriba", "Abajo", "Izquierda", "Derecha"]'::jsonb, 'Arriba', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Hacia dónde abre la parábola y = x²?' AND dificultad = 'Principiante' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 2, 'test', 'Intermedio', '¿Cuál es la intersección en y de y = 2x² + 3x + 5?', '["2", "3", "5", "0"]'::jsonb, '5', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Cuál es la intersección en y de y = 2x² + 3x + 5?' AND dificultad = 'Intermedio' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 2, 'test', 'Intermedio', 'Encuentra las raíces de x² − 5x + 6 = 0', '["x = 2, x = 3", "x = −2, x = −3", "x = 1, x = 6", "x = 0"]'::jsonb, 'x = 2, x = 3', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Encuentra las raíces de x² − 5x + 6 = 0' AND dificultad = 'Intermedio' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 2, 'test', 'Intermedio', '¿Cuál es el eje de simetría de y = x² − 4x?', '["x = 4", "x = 2", "y = 2", "x = −2"]'::jsonb, 'x = 2', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Cuál es el eje de simetría de y = x² − 4x?' AND dificultad = 'Intermedio' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 2, 'test', 'Avanzado', 'Encuentra el vértice de y = 2(x − 3)² + 4', '["(3,4)", "(−3,4)", "(3,−4)", "(2,4)"]'::jsonb, '(3,4)', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Encuentra el vértice de y = 2(x − 3)² + 4' AND dificultad = 'Avanzado' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 2, 'test', 'Avanzado', '¿Cuántas raíces reales tiene 3x² + x + 5 = 0?', '["0", "1", "2", "Infinitas"]'::jsonb, '0', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Cuántas raíces reales tiene 3x² + x + 5 = 0?' AND dificultad = 'Avanzado' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 2, 'test', 'Avanzado', 'Factoriza completamente: 4x² − 12x + 9', '["(2x − 3)²", "(2x + 3)²", "(4x − 3)(x − 3)", "(2x − 3)(2x + 3)"]'::jsonb, '(2x − 3)²', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Factoriza completamente: 4x² − 12x + 9' AND dificultad = 'Avanzado' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 3, 'test', 'Principiante', '¿Cuál es el área de un cuadrado de lado 4?', '["8", "12", "16", "4"]'::jsonb, '16', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Cuál es el área de un cuadrado de lado 4?' AND dificultad = 'Principiante' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 3, 'test', 'Principiante', '¿Cuánto suman los ángulos interiores de un triángulo?', '["90°", "180°", "360°", "270°"]'::jsonb, '180°', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Cuánto suman los ángulos interiores de un triángulo?' AND dificultad = 'Principiante' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 3, 'test', 'Principiante', '¿Cuál es el perímetro de un rectángulo de 3 × 4?', '["7", "12", "14", "24"]'::jsonb, '14', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Cuál es el perímetro de un rectángulo de 3 × 4?' AND dificultad = 'Principiante' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 3, 'test', 'Intermedio', '¿Cuál es el área de un círculo de radio 3?', '["6π", "9π", "3π", "12π"]'::jsonb, '9π', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Cuál es el área de un círculo de radio 3?' AND dificultad = 'Intermedio' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 3, 'test', 'Intermedio', '¿Cuánto mide la hipotenusa si los catetos miden 3 y 4?', '["5", "7", "12", "25"]'::jsonb, '5', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Cuánto mide la hipotenusa si los catetos miden 3 y 4?' AND dificultad = 'Intermedio' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 3, 'test', 'Intermedio', '¿Cuál es el volumen de un cubo de arista 3?', '["9", "18", "27", "81"]'::jsonb, '27', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Cuál es el volumen de un cubo de arista 3?' AND dificultad = 'Intermedio' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 3, 'test', 'Avanzado', 'Volumen de un cilindro con r = 2 y h = 5', '["10π", "20π", "10", "25π"]'::jsonb, '20π', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Volumen de un cilindro con r = 2 y h = 5' AND dificultad = 'Avanzado' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 3, 'test', 'Avanzado', 'Suma de los ángulos interiores de un hexágono', '["360°", "540°", "720°", "180°"]'::jsonb, '720°', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Suma de los ángulos interiores de un hexágono' AND dificultad = 'Avanzado' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 3, 'test', 'Avanzado', 'Diagonal de un cuadrado de lado 5', '["5", "10", "5√2", "25"]'::jsonb, '5√2', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Diagonal de un cuadrado de lado 5' AND dificultad = 'Avanzado' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 4, 'test', 'Principiante', 'Si compras 3 manzanas a $2 cada una, ¿cuánto pagas?', '["$5", "$6", "$2", "$1"]'::jsonb, '$6', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Si compras 3 manzanas a $2 cada una, ¿cuánto pagas?' AND dificultad = 'Principiante' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 4, 'test', 'Principiante', 'Viajas 100 km en 2 horas, ¿cuál es tu velocidad media?', '["200 km/h", "100 km/h", "50 km/h", "20 km/h"]'::jsonb, '50 km/h', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Viajas 100 km en 2 horas, ¿cuál es tu velocidad media?' AND dificultad = 'Principiante' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 4, 'test', 'Principiante', 'Descuento del 10% sobre $100: ¿cuánto pagas?', '["$10", "$90", "$100", "$0"]'::jsonb, '$90', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Descuento del 10% sobre $100: ¿cuánto pagas?' AND dificultad = 'Principiante' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 4, 'test', 'Intermedio', 'Un auto viaja a 100 km/h durante 2,5 horas, ¿qué distancia recorre?', '["200 km", "250 km", "150 km", "300 km"]'::jsonb, '250 km', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Un auto viaja a 100 km/h durante 2,5 horas, ¿qué distancia recorre?' AND dificultad = 'Intermedio' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 4, 'test', 'Intermedio', 'Un tanque de 50 L pierde el 20%, ¿cuántos litros quedan?', '["30 L", "40 L", "45 L", "10 L"]'::jsonb, '40 L', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Un tanque de 50 L pierde el 20%, ¿cuántos litros quedan?' AND dificultad = 'Intermedio' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 4, 'test', 'Intermedio', 'Un corredor hace 5 km en 25 minutos, ¿cuál es su ritmo?', '["4 min/km", "5 min/km", "6 min/km", "10 min/km"]'::jsonb, '5 min/km', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Un corredor hace 5 km en 25 minutos, ¿cuál es su ritmo?' AND dificultad = 'Intermedio' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 4, 'test', 'Avanzado', 'Interés simple del 5% anual sobre $1000 durante 3 años', '["$50", "$150", "$1150", "$1500"]'::jsonb, '$150', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Interés simple del 5% anual sobre $1000 durante 3 años' AND dificultad = 'Avanzado' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 4, 'test', 'Avanzado', 'Si f(t) = −5t² + 20t modela una altura, ¿en qué tiempo es máxima?', '["2 s", "4 s", "5 s", "10 s"]'::jsonb, '2 s', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Si f(t) = −5t² + 20t modela una altura, ¿en qué tiempo es máxima?' AND dificultad = 'Avanzado' AND tipo = 'test');
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 4, 'test', 'Avanzado', 'Mezclas 2 L al 10% con 3 L al 20%, ¿concentración final?', '["15%", "16%", "30%", "12%"]'::jsonb, '16%', 'maqueta'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Mezclas 2 L al 10% con 3 L al 20%, ¿concentración final?' AND dificultad = 'Avanzado' AND tipo = 'test');
