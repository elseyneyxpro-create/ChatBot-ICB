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

-- Carrera de cada alumno (Ing. Civil Industrial, Ing. Civil en Informática y Telecomunicaciones…).
-- La cargan los profesores junto con el nivel inicial. Durante la nivelación los alumnos aún no
-- tienen sección, así que el panel docente los agrupa por carrera. Texto libre; NULL = sin carrera.
ALTER TABLE IF EXISTS public.whitelist_alumnos ADD COLUMN IF NOT EXISTS carrera text;

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


-- ─── Mapa de la nivelación (Cuaderno de nivelación Matemática ICB-UDP, oct 2026) ───
-- 5 mundos y 26 nodos, en el orden del cuaderno. Los profesores pueden cambiar títulos y
-- descripciones. "guia" es el contexto que usan los agentes de IA (tutor, generador de
-- preguntas y retroalimentación): objetivos, ideas clave y errores frecuentes del cuaderno.
-- Para pasar una base que tenga el mapa antiguo (4 mundos de la maqueta) a este, correr antes
-- deploy/sql/migrar_mundos_cuaderno.sql.
ALTER TABLE niv_banco.nodo ADD COLUMN IF NOT EXISTS guia text;

INSERT INTO niv_banco.mundo (id, orden, titulo, descripcion, icono) VALUES (1, 1, 'Números, potencias y raíces', 'Sistemas numéricos, fracciones, potencias, raíces y racionalización (Cuaderno, cap. 1).', 'calculate') ON CONFLICT (id) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo, descripcion, guia) VALUES (1, 1, 'Sistemas numéricos y jerarquía de operaciones', 'Naturales, enteros y el orden correcto para operar.', 'Cuaderno cap. 1.1 (pp. 11-17).
Objetivos: distinguir sistemas numéricos (N, Z, Q, I, R) y sus propiedades (clausura, conmutatividad, asociatividad, distributividad); operar con naturales y enteros respetando la jerarquía: paréntesis, luego productos y cocientes de izquierda a derecha, luego sumas y restas.
Ideas clave: sucesor y antecesor; números primos y factorización prima; divisores comunes; la resta como suma del inverso aditivo; orden en la recta numérica.
Errores frecuentes: operar de izquierda a derecha sin respetar la jerarquía; olvidar el signo al quitar paréntesis; confundir sucesor con antecesor en negativos.
Problemas típicos: enteros consecutivos (la suma de tres consecutivos es 93), reparto en partes iguales, divisibilidad de productos de consecutivos.')
  ON CONFLICT (mundo_id, orden) DO UPDATE SET guia = COALESCE(niv_banco.nodo.guia, EXCLUDED.guia);
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo, descripcion, guia) VALUES (1, 2, 'Fracciones y números racionales', 'Ordenar, operar y resolver problemas con fracciones.', 'Cuaderno cap. 1.2 (pp. 19-23).
Objetivos: definir Q como cocientes a/b con b ≠ 0; operar (suma, producto, división, fracciones compuestas); comparar y ordenar fracciones; resolver problemas de reparto.
Ideas clave: a/b = c/d si y solo si ad = bc; densidad de Q; fracción de una cantidad; fracción "del resto" (no del total).
Errores frecuentes: sumar numeradores y denominadores (1/2 + 1/3 = 2/5 es incorrecto, es 5/6); en "1/4 de lo que quedó" calcular sobre el total; no simplificar.
Problemas típicos (método de Polya: comprendo, planifico, ejecuto, verifico): repartir dinero en fracciones, tuberías que llenan un tanque (fracción por hora).')
  ON CONFLICT (mundo_id, orden) DO UPDATE SET guia = COALESCE(niv_banco.nodo.guia, EXCLUDED.guia);
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo, descripcion, guia) VALUES (1, 3, 'Números reales e irracionales', 'Irracionales, propiedades de los reales y reglas de signos.', 'Cuaderno cap. 1.2 (pp. 19-22).
Objetivos: reconocer números irracionales (√2, π, e: decimales infinitos no periódicos); propiedades de cuerpo de R (neutros, inversos); reglas de signos; el orden en la recta.
Ideas clave: √2 es la diagonal del cuadrado de lado 1; I no es un sistema numérico (√2·√2 = 2 no es irracional); −(a − b) = b − a; (−a)(−b) = ab.
Errores frecuentes: creer que toda raíz es irracional (√9 = 3); creer que los irracionales son cerrados bajo suma o producto; errores de signo con −(a − b).
Preguntas típicas: verdadero o falso justificado, clasificar números, ordenar √2, √3, √5.')
  ON CONFLICT (mundo_id, orden) DO UPDATE SET guia = COALESCE(niv_banco.nodo.guia, EXCLUDED.guia);
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo, descripcion, guia) VALUES (1, 4, 'Potencias y notación científica', 'Leyes de exponentes, exponente cero y negativo, notación científica.', 'Cuaderno cap. 1.3 (pp. 23-25).
Objetivos: aplicar a^n·a^m = a^(n+m), a^n/a^m = a^(n−m), (a^n)^m = a^(nm), (ab)^n = a^n b^n, (a/b)^n; a^0 = 1 y a^(−n) = 1/a^n; notación científica.
Errores frecuentes del cuaderno ("determine el error"): −5² + 1 = 26 (en realidad −5² = −25); (3 − π)² = 9 − π²; 4·3² = 144 (es 36); 3² + 7² = 10²; confundir (a^n)^m con a^(n+m).
Problemas típicos: combinaciones de un candado (10^4), tiempo que tarda la luz del Sol (1,5×10^11 / 3×10^8 s), densidad de una célula.')
  ON CONFLICT (mundo_id, orden) DO UPDATE SET guia = COALESCE(niv_banco.nodo.guia, EXCLUDED.guia);
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo, descripcion, guia) VALUES (1, 5, 'Raíces y racionalización', 'Raíz n-ésima, exponente racional, valor absoluto y racionalizar.', 'Cuaderno cap. 1.4 (pp. 25-28).
Objetivos: definir la raíz n-ésima (índice par exige radicando ≥ 0); a^(m/n) = ⁿ√(a^m); leyes de raíces; √(a²) = |a|; racionalizar denominadores con conjugados y con suma/diferencia de cubos.
Ideas clave: descomponer en factores primos para simplificar (√(16·49·64) = 224); 1/(√a + √b) = (√a − √b)/(a − b).
Errores frecuentes: √(a²) = a (es |a|); √(a + b) = √a + √b; racionalizar multiplicando solo el denominador.
Problemas típicos: lado de una cocina cuadrada a partir de baldosas, largo de una escalera (Pitágoras).')
  ON CONFLICT (mundo_id, orden) DO UPDATE SET guia = COALESCE(niv_banco.nodo.guia, EXCLUDED.guia);
INSERT INTO niv_banco.mundo (id, orden, titulo, descripcion, icono) VALUES (2, 2, 'Álgebra', 'Expresiones algebraicas, productos notables, factorización y fracciones algebraicas (Cuaderno, cap. 2).', 'functions') ON CONFLICT (id) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo, descripcion, guia) VALUES (2, 1, 'Expresiones algebraicas y evaluación', 'Términos semejantes, paréntesis y evaluar expresiones.', 'Cuaderno cap. 2.1 (pp. 29-32).
Objetivos: identificar coeficiente y factor literal; reducir términos semejantes (asociar, factorizar, sumar); eliminar paréntesis (signo − delante cambia todos los signos); evaluar expresiones reemplazando con paréntesis.
Errores frecuentes: evaluar 2x² en x = −1 como 2·−1² = −2 (correcto: 2·(−1)² = 2); sumar términos no semejantes (3a + 2b = 5ab); no cambiar todos los signos al quitar −( ).
Problemas típicos: representar áreas y volúmenes con expresiones; fórmula de diagonales de un polígono d = n(n − 3)/2.')
  ON CONFLICT (mundo_id, orden) DO UPDATE SET guia = COALESCE(niv_banco.nodo.guia, EXCLUDED.guia);
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo, descripcion, guia) VALUES (2, 2, 'Productos notables', 'Cuadrado y cubo de binomio, suma por diferencia y más.', 'Cuaderno cap. 2.1.2 (pp. 32-34).
Objetivos: desarrollar (a ± b)², (a ± b)³, (a + b)(a − b) = a² − b², (x + a)(x + b) = x² + (a + b)x + ab, suma y diferencia de cubos; usarlos para racionalizar.
Errores frecuentes: (a + b)² = a² + b² (falta 2ab; contraejemplo a = b = 1); signos en (a − b)³; olvidar elevar el coeficiente: (2x)² = 2x².')
  ON CONFLICT (mundo_id, orden) DO UPDATE SET guia = COALESCE(niv_banco.nodo.guia, EXCLUDED.guia);
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo, descripcion, guia) VALUES (2, 3, 'Factorización', 'Factor común, diferencia de cuadrados, trinomios y cubos.', 'Cuaderno cap. 2.2 (pp. 35-36, 39).
Objetivos: factorizar por factor común (numérico, término, expresión), diferencia de cuadrados, trinomio cuadrado perfecto, trinomio x² + (a+b)x + ab, suma y diferencia de cubos; factorizar por agrupación.
Errores frecuentes: x² + 4 = (x + 2)(x − 2) (la suma de cuadrados no se factoriza en R); signos al buscar dos números que suman b y multiplican c; no sacar todo el factor común.
Ejemplos del cuaderno: x(b + 2) − b − 2 + 3(b + 2); x^6 + 5x³ + 6; 9x² − 4y² = (3x + 2y)(3x − 2y).')
  ON CONFLICT (mundo_id, orden) DO UPDATE SET guia = COALESCE(niv_banco.nodo.guia, EXCLUDED.guia);
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo, descripcion, guia) VALUES (2, 4, 'Fracciones algebraicas: mcm y simplificación', 'Mínimo común múltiplo y simplificar con restricciones.', 'Cuaderno cap. 2.2.1 (pp. 36-38).
Objetivos: grado de un término y de una expresión; mcm de expresiones algebraicas factorizando; simplificar fracciones algebraicas cancelando FACTORES comunes e indicar las restricciones (valores que anulan el denominador).
Errores frecuentes: cancelar términos en vez de factores ((x² + 4)/(x + 2) = x + 2 es incorrecto); olvidar las restricciones; confundir mcm con el producto de todo.')
  ON CONFLICT (mundo_id, orden) DO UPDATE SET guia = COALESCE(niv_banco.nodo.guia, EXCLUDED.guia);
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo, descripcion, guia) VALUES (2, 5, 'Operaciones con fracciones algebraicas', 'Sumar, restar, multiplicar, dividir y fracciones compuestas.', 'Cuaderno cap. 2.2 (pp. 38-39).
Objetivos: operar fracciones algebraicas con mcm; multiplicar y dividir (invertir la segunda); simplificar fracciones compuestas ((1/a + 1/b)/(1/a − 1/b) = (b + a)/(b − a)) indicando restricciones.
Errores frecuentes: sumar denominadores; olvidar distribuir el signo − en el numerador; no factorizar antes de simplificar.')
  ON CONFLICT (mundo_id, orden) DO UPDATE SET guia = COALESCE(niv_banco.nodo.guia, EXCLUDED.guia);
INSERT INTO niv_banco.mundo (id, orden, titulo, descripcion, icono) VALUES (3, 3, 'Lineal y cuadrática', 'Ecuaciones lineales y cuadráticas y problemas de planteo (Cuaderno, cap. 3).', 'balance') ON CONFLICT (id) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo, descripcion, guia) VALUES (3, 1, 'Ecuaciones lineales', 'Despejar con propiedades de la igualdad, con paréntesis y fracciones.', 'Cuaderno cap. 3.1 (pp. 41-45).
Objetivos: comprender qué es una ecuación, sus raíces y el conjunto solución; usar las propiedades aditiva y multiplicativa de la igualdad; resolver ecuaciones lineales con coeficientes enteros y fraccionarios y con productos notables; verificar la solución.
Errores frecuentes: pasar un término "al otro lado" sin cambiar la operación; multiplicar solo algunos términos por el mcm; no verificar.')
  ON CONFLICT (mundo_id, orden) DO UPDATE SET guia = COALESCE(niv_banco.nodo.guia, EXCLUDED.guia);
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo, descripcion, guia) VALUES (3, 2, 'Ecuaciones con fracciones y parámetros', 'Ecuaciones racionales con restricciones y ecuaciones con parámetro.', 'Cuaderno cap. 3.1.2 (p. 45).
Objetivos: resolver ecuaciones con incógnita en el denominador indicando restricciones y descartando soluciones no válidas; analizar para qué valores de un parámetro m una ecuación no tiene solución (coeficiente de x igual a 0 con término independiente distinto de 0).
Errores frecuentes: aceptar una solución que anula un denominador; dividir por una expresión que puede ser 0.')
  ON CONFLICT (mundo_id, orden) DO UPDATE SET guia = COALESCE(niv_banco.nodo.guia, EXCLUDED.guia);
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo, descripcion, guia) VALUES (3, 3, 'Problemas de planteo lineales', 'Traducir enunciados a ecuaciones y modelos lineales.', 'Cuaderno cap. 3.1 (pp. 44-45). Método de Polya: comprendo, planifico, ejecuto, verifico.
Objetivos: traducir un enunciado a una ecuación lineal y resolverlo; usar modelos lineales dados (ritmo cardíaco máximo m = −0,875x + 190; pérdida de peso w = 0,02c).
Problemas típicos: números consecutivos, dividir 200 en dos partes, personas en una reunión, perímetro de un rectángulo.
Errores frecuentes: definir mal la incógnita; no responder la pregunta del problema; no revisar si el resultado tiene sentido (unidades, signo).')
  ON CONFLICT (mundo_id, orden) DO UPDATE SET guia = COALESCE(niv_banco.nodo.guia, EXCLUDED.guia);
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo, descripcion, guia) VALUES (3, 4, 'Ecuaciones cuadráticas: factorización y raíz', 'Resolver por producto cero y por raíz cuadrada.', 'Cuaderno cap. 3.2 (pp. 46-47).
Objetivos: reconocer ax² + bx + c = 0 (a ≠ 0); resolver factorizando y usando la propiedad del producto cero (AB = 0 si y solo si A = 0 o B = 0); resolver x² = c y (x − h)² = c con raíz cuadrada (dos soluciones ±).
Errores frecuentes: olvidar la solución negativa (x² = 9 → solo x = 3); dividir por x y perder la solución x = 0; igualar a un número distinto de 0 y aplicar producto cero.')
  ON CONFLICT (mundo_id, orden) DO UPDATE SET guia = COALESCE(niv_banco.nodo.guia, EXCLUDED.guia);
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo, descripcion, guia) VALUES (3, 5, 'Completar cuadrado, fórmula general y discriminante', 'Resolver cualquier cuadrática y anticipar cuántas soluciones tiene.', 'Cuaderno cap. 3.2 (pp. 47-50).
Objetivos: completar cuadrado (x² + bx + (b/2)² = (x + b/2)²); deducir y usar la fórmula general x = (−b ± √(b² − 4ac))/(2a); discriminante Δ = b² − 4ac (Δ > 0 dos soluciones, Δ = 0 una, Δ < 0 ninguna real); suma de raíces −b/a y producto c/a.
Errores frecuentes: signo de b en la fórmula; dividir solo −b por 2a; calcular mal Δ con c negativo; olvidar dividir por a antes de completar cuadrado.')
  ON CONFLICT (mundo_id, orden) DO UPDATE SET guia = COALESCE(niv_banco.nodo.guia, EXCLUDED.guia);
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo, descripcion, guia) VALUES (3, 6, 'Problemas de planteo cuadráticos', 'Plantear y resolver problemas con ecuaciones de segundo grado.', 'Cuaderno cap. 3.2.1 (p. 50).
Objetivos: plantear problemas que llevan a una cuadrática y elegir la solución que tiene sentido en el contexto.
Problemas típicos: lados de un triángulo rectángulo con enteros consecutivos (3, 4, 5); número igual al triple de sí mismo; suma de cuadrados de pares consecutivos 580; ganancia porcentual igual al costo.
Errores frecuentes: no descartar soluciones negativas o sin sentido; plantear Pitágoras con el lado mayor como cateto.')
  ON CONFLICT (mundo_id, orden) DO UPDATE SET guia = COALESCE(niv_banco.nodo.guia, EXCLUDED.guia);
INSERT INTO niv_banco.mundo (id, orden, titulo, descripcion, icono) VALUES (4, 4, 'Geometría analítica', 'Plano cartesiano, distancia, circunferencia, recta y parábola (Cuaderno, cap. 4.1–4.5).', 'show_chart') ON CONFLICT (id) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo, descripcion, guia) VALUES (4, 1, 'Plano cartesiano, distancia y punto medio', 'Ubicar puntos, medir distancias y encontrar el punto medio.', 'Cuaderno cap. 4.2 (pp. 51-54).
Objetivos: ubicar pares ordenados y cuadrantes; distancia d(A,B) = √((x2 − x1)² + (y2 − y1)²) (viene de Pitágoras); punto medio M = ((x1 + x2)/2, (y1 + y2)/2); clasificar triángulos por sus lados usando coordenadas.
Errores frecuentes: confundir (2,5) con (5,2); restar coordenadas mezcladas (x con y); olvidar la raíz; promediar mal el punto medio.')
  ON CONFLICT (mundo_id, orden) DO UPDATE SET guia = COALESCE(niv_banco.nodo.guia, EXCLUDED.guia);
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo, descripcion, guia) VALUES (4, 2, 'Ecuación de una curva y circunferencia', 'Una ecuación describe una curva; circunferencia con centro y radio.', 'Cuaderno cap. 4.3 (pp. 54-56).
Objetivos: un punto está en la curva si y solo si sus coordenadas satisfacen la ecuación (lugar geométrico); circunferencia (x − h)² + (y − k)² = r²; completar cuadrados para hallar centro y radio; mediatriz como lugar de puntos que equidistan de dos puntos.
Errores frecuentes (del cuaderno): x² + y² = 9 tiene radio 9 (el radio es 3); (x + 2)² + (y − 1)² = 4 tiene centro (2, −1) (es (−2, 1)); creer que la curva es solo la tabla de puntos.')
  ON CONFLICT (mundo_id, orden) DO UPDATE SET guia = COALESCE(niv_banco.nodo.guia, EXCLUDED.guia);
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo, descripcion, guia) VALUES (4, 3, 'Pendiente y ecuación de la recta', 'Pendiente como razón de cambio y las formas de la recta.', 'Cuaderno cap. 4.4.1-4.4.3 (pp. 56-59). Pensamiento variacional: en una recta Δy/Δx es constante.
Objetivos: pendiente m = Δy/Δx (no definida en rectas verticales); ecuación punto-pendiente y − y1 = m(x − x1); forma principal y = mx + n; forma general Ax + By + C = 0 (m = −A/B); rectas horizontales y verticales; interpretar la pendiente con unidades (temperatura vs altitud: −10 °C/km).
Errores frecuentes: invertir Δx y Δy; signo de la pendiente; leer n como corte con el eje X; creer que x = 3 no es una recta.')
  ON CONFLICT (mundo_id, orden) DO UPDATE SET guia = COALESCE(niv_banco.nodo.guia, EXCLUDED.guia);
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo, descripcion, guia) VALUES (4, 4, 'Paralelas, perpendiculares, intersección y distancia punto-recta', 'Relaciones entre rectas y distancias.', 'Cuaderno cap. 4.4.4-4.4.6 (pp. 59-61).
Objetivos: paralelas si m1 = m2; perpendiculares si m1·m2 = −1; intersección resolviendo el sistema de dos ecuaciones; distancia de P(x0, y0) a Ax + By + C = 0: |Ax0 + By0 + C|/√(A² + B²) (la recta en forma general); forma segmentaria x/a + y/b = 1; problemas de modelación lineal (grillos, depreciación, Celsius-Fahrenheit).
Errores frecuentes: perpendicular con la misma pendiente cambiada de signo (es la recíproca con signo opuesto); usar la fórmula de distancia con la recta en forma y = mx + n sin reordenar.')
  ON CONFLICT (mundo_id, orden) DO UPDATE SET guia = COALESCE(niv_banco.nodo.guia, EXCLUDED.guia);
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo, descripcion, guia) VALUES (4, 5, 'Parábola: formas y coeficientes', 'Forma general, canónica y factorizada; efecto de a, h y k.', 'Cuaderno cap. 4.5.1-4.5.2 (pp. 61-63). Pensamiento variacional: en la parábola lo constante es el "cambio de los cambios" (2a).
Objetivos: y = ax² + bx + c (a ≠ 0); forma canónica y = a(x − h)² + k (vértice (h, k)); forma factorizada y = a(x − x1)(x − x2) (ceros); signo de a (abre hacia arriba o abajo); |a| grande = más angosta; h y k trasladan la curva.
Errores frecuentes: en (x − 2)² creer que h = −2; confundir el corte con el eje Y (0, c) con el vértice; creer que toda parábola tiene forma factorizada.')
  ON CONFLICT (mundo_id, orden) DO UPDATE SET guia = COALESCE(niv_banco.nodo.guia, EXCLUDED.guia);
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo, descripcion, guia) VALUES (4, 6, 'Vértice, ceros y modelación con parábolas', 'Elementos de la parábola y problemas de máximos y mínimos.', 'Cuaderno cap. 4.5.3-4.5.4 (pp. 63-68).
Objetivos: vértice h = −b/(2a), k reemplazando; eje de simetría x = h; ceros con Δ (dos, uno o ninguno); h es el promedio de los ceros; intersección recta-parábola; problemas de máximo o mínimo (balón pateado y = −x²/5 + 2x, lanzamiento vertical y = 15 + 10t − 5t², ingreso máximo, arco de un túnel con método de Polya); decidir con tablas de Δy si los datos son de una recta, una parábola o ninguna.
Errores frecuentes: signo de h; responder el x del vértice cuando se pide el valor máximo (y); no descartar tiempos negativos.')
  ON CONFLICT (mundo_id, orden) DO UPDATE SET guia = COALESCE(niv_banco.nodo.guia, EXCLUDED.guia);
INSERT INTO niv_banco.mundo (id, orden, titulo, descripcion, icono) VALUES (5, 5, 'Geometría elemental', 'Pitágoras, perímetros, áreas, volúmenes y escalas (Cuaderno, cap. 4.6).', 'change_history') ON CONFLICT (id) DO NOTHING;
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo, descripcion, guia) VALUES (5, 1, 'Teorema de Pitágoras', 'Pitágoras, su recíproco y sus aplicaciones.', 'Cuaderno cap. 4.6.1 (pp. 68-69).
Objetivos: a² + b² = c² en triángulos rectángulos (c hipotenusa); recíproco para decidir si un triángulo es rectángulo; altura del triángulo equilátero h = (√3/2)ℓ; aplicaciones (escaleras, pantallas 16:9, diagonal de un parque).
Errores frecuentes (del cuaderno): catetos 3 y 4 → hipotenusa 7 (es 5); aplicar Pitágoras en triángulos no rectángulos o con c que no es la hipotenusa.')
  ON CONFLICT (mundo_id, orden) DO UPDATE SET guia = COALESCE(niv_banco.nodo.guia, EXCLUDED.guia);
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo, descripcion, guia) VALUES (5, 2, 'Perímetro y área de figuras planas', 'Cuadrado, rectángulo, triángulo, rombo, trapecio y círculo.', 'Cuaderno cap. 4.6.2 (pp. 69-70).
Objetivos: perímetro (longitud del borde, unidades lineales) y área (unidades cuadradas) de cuadrado, rectángulo, triángulo, paralelogramo, rombo (d1·d2/2), trapecio ((B + b)h/2) y círculo (2πr y πr²); figuras compuestas (ventana con semicírculo); figuras con coordenadas.
Errores frecuentes: confundir 2πr con πr²; usar diámetro como radio; mezclar unidades (cm con m).')
  ON CONFLICT (mundo_id, orden) DO UPDATE SET guia = COALESCE(niv_banco.nodo.guia, EXCLUDED.guia);
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo, descripcion, guia) VALUES (5, 3, 'Volumen y superficie de cuerpos', 'Cubo, prisma, cilindro, pirámide, cono y esfera.', 'Cuaderno cap. 4.6.3 (pp. 71-72).
Objetivos: volumen (unidades cúbicas) y superficie total de cubo, paralelepípedo, prisma, cilindro (πr²h, 2πr² + 2πrh), pirámide (Ab·h/3), cono (πr²h/3, generatriz g = √(r² + h²)) y esfera (4πr³/3, 4πr²); conversiones (1 L = 1000 cm³, 1 m³ = 1000 L); diagonal de una caja √(a² + b² + c²).
Errores frecuentes: expresar volumen en cm²; olvidar el 1/3 en conos y pirámides; no convertir unidades antes de calcular litros.')
  ON CONFLICT (mundo_id, orden) DO UPDATE SET guia = COALESCE(niv_banco.nodo.guia, EXCLUDED.guia);
INSERT INTO niv_banco.nodo (mundo_id, orden, titulo, descripcion, guia) VALUES (5, 4, 'Escala y problemas de planteo geométricos', 'Cómo cambian medidas al escalar y problemas del enunciado a la figura.', 'Cuaderno cap. 4.6 (pp. 70-73). Del enunciado a la figura y de la figura a la solución (Polya).
Objetivos: si las longitudes se multiplican por k, el perímetro se multiplica por k, el área por k² y el volumen por k³; construir el esquema de una situación descrita en palabras y resolverla (encomienda cúbica de 27.000 cm³ cobrada por metro lineal, piscina, estanque, terreno heredado).
Errores frecuentes (del cuaderno): duplicar el lado y creer que el área se duplica (se cuadruplica); para multiplicar el volumen por 27 multiplicar las aristas por 27 (es por 3).')
  ON CONFLICT (mundo_id, orden) DO UPDATE SET guia = COALESCE(niv_banco.nodo.guia, EXCLUDED.guia);
SELECT setval(pg_get_serial_sequence('niv_banco.mundo','id'), GREATEST((SELECT max(id) FROM niv_banco.mundo), 1));

-- ─── Preguntas de ejemplo ───────────────────────────────────────────────────
-- Las de 'nodo' sin mundo son generales (de la maqueta), para practicar mientras los profesores
-- cargan las de cada nodo. Las de 'test' son de muestra por mundo, sacadas del cuaderno
-- (creado_por = 'muestra'): reemplazarlas por las del banco de los profesores.
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
  SELECT 1, 'test', 'Principiante', 'Calcula 6 · (−4 + 2) − 3 · (5 − 9)', '["0", "−24", "24", "−12"]'::jsonb, '0', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Calcula 6 · (−4 + 2) − 3 · (5 − 9)' AND tipo = 'test' AND mundo_id = 1);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 1, 'test', 'Principiante', '¿Cuánto es $\frac{2}{3} + \frac{4}{5}$?', '["$\\frac{6}{8}$", "$\\frac{22}{15}$", "$\\frac{8}{15}$", "$\\frac{6}{15}$"]'::jsonb, '$\frac{22}{15}$', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Cuánto es $\frac{2}{3} + \frac{4}{5}$?' AND tipo = 'test' AND mundo_id = 1);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 1, 'test', 'Principiante', '¿Cuál de estos números es irracional?', '["$\\sqrt{9}$", "$0{,}25$", "$\\sqrt{7}$", "$-\\frac{3}{4}$"]'::jsonb, '$\sqrt{7}$', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Cuál de estos números es irracional?' AND tipo = 'test' AND mundo_id = 1);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 1, 'test', 'Intermedio', 'Simplifica $\frac{3^6}{3^2} \cdot 3^{-1}$', '["$3^3$", "$3^4$", "$3^2$", "$3^{-3}$"]'::jsonb, '$3^3$', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Simplifica $\frac{3^6}{3^2} \cdot 3^{-1}$' AND tipo = 'test' AND mundo_id = 1);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 1, 'test', 'Intermedio', '¿Cuánto es $\sqrt{16 \cdot 49 \cdot 64}$?', '["224", "112", "448", "56"]'::jsonb, '224', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Cuánto es $\sqrt{16 \cdot 49 \cdot 64}$?' AND tipo = 'test' AND mundo_id = 1);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 1, 'test', 'Intermedio', 'Natalia gana 550.000 pesos, gasta 1/5 en estudios y 1/4 de lo que le queda en su auto. ¿Cuánto le queda?', '["330.000 pesos", "302.500 pesos", "412.500 pesos", "357.500 pesos"]'::jsonb, '330.000 pesos', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Natalia gana 550.000 pesos, gasta 1/5 en estudios y 1/4 de lo que le queda en su auto. ¿Cuánto le queda?' AND tipo = 'test' AND mundo_id = 1);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 1, 'test', 'Avanzado', 'Racionaliza $\frac{1}{\sqrt{3} + \sqrt{2}}$', '["$\\sqrt{3} - \\sqrt{2}$", "$\\sqrt{3} + \\sqrt{2}$", "$\\frac{\\sqrt{3} - \\sqrt{2}}{5}$", "$\\frac{1}{5}$"]'::jsonb, '$\sqrt{3} - \sqrt{2}$', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Racionaliza $\frac{1}{\sqrt{3} + \sqrt{2}}$' AND tipo = 'test' AND mundo_id = 1);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 1, 'test', 'Avanzado', 'Si $x = -3$, ¿cuánto vale $\sqrt{x^2}$?', '["−3", "3", "9", "No está definido"]'::jsonb, '3', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Si $x = -3$, ¿cuánto vale $\sqrt{x^2}$?' AND tipo = 'test' AND mundo_id = 1);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 1, 'test', 'Avanzado', 'La luz viaja a $3 \times 10^8$ m/s y el Sol está a $1{,}5 \times 10^{11}$ m. ¿Cuántos segundos tarda la luz en llegar?', '["$5 \\times 10^2$", "$5 \\times 10^{3}$", "$4{,}5 \\times 10^{19}$", "$2 \\times 10^{-3}$"]'::jsonb, '$5 \times 10^2$', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'La luz viaja a $3 \times 10^8$ m/s y el Sol está a $1{,}5 \times 10^{11}$ m. ¿Cuántos segundos tarda la luz en llegar?' AND tipo = 'test' AND mundo_id = 1);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 2, 'test', 'Principiante', 'Reduce $5a^2b^3 - 4ac + 3a^2b^3 + 3ac$', '["$8a^2b^3 - ac$", "$8a^2b^3 + ac$", "$7a^2b^3 - ac$", "$8a^4b^6 - ac$"]'::jsonb, '$8a^2b^3 - ac$', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Reduce $5a^2b^3 - 4ac + 3a^2b^3 + 3ac$' AND tipo = 'test' AND mundo_id = 2);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 2, 'test', 'Principiante', 'Desarrolla $(2x + 3)^2$', '["$4x^2 + 9$", "$4x^2 + 6x + 9$", "$4x^2 + 12x + 9$", "$2x^2 + 12x + 9$"]'::jsonb, '$4x^2 + 12x + 9$', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Desarrolla $(2x + 3)^2$' AND tipo = 'test' AND mundo_id = 2);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 2, 'test', 'Principiante', 'Evalúa $2x^2$ en $x = -1$', '["−2", "2", "4", "−4"]'::jsonb, '2', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Evalúa $2x^2$ en $x = -1$' AND tipo = 'test' AND mundo_id = 2);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 2, 'test', 'Intermedio', 'Factoriza $x^2 + 3x - 10$', '["$(x + 5)(x - 2)$", "$(x - 5)(x + 2)$", "$(x + 10)(x - 1)$", "$(x - 5)(x - 2)$"]'::jsonb, '$(x + 5)(x - 2)$', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Factoriza $x^2 + 3x - 10$' AND tipo = 'test' AND mundo_id = 2);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 2, 'test', 'Intermedio', 'Factoriza $9x^2 - 4y^2$', '["$(3x - 2y)^2$", "$(3x + 2y)(3x - 2y)$", "$(9x + 4y)(x - y)$", "No se puede factorizar"]'::jsonb, '$(3x + 2y)(3x - 2y)$', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Factoriza $9x^2 - 4y^2$' AND tipo = 'test' AND mundo_id = 2);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 2, 'test', 'Intermedio', '¿Cuál es el mcm de $a + 1$, $a - 1$ y $a^2 - 1$?', '["$(a+1)(a-1)(a^2-1)$", "$a^2 - 1$", "$a^2 + 1$", "$(a + 1)^2$"]'::jsonb, '$a^2 - 1$', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Cuál es el mcm de $a + 1$, $a - 1$ y $a^2 - 1$?' AND tipo = 'test' AND mundo_id = 2);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 2, 'test', 'Avanzado', 'Simplifica $\frac{x^3 + 3x^2 - 10x}{x^3 - 4x^2 + 4x}$', '["$\\frac{x + 5}{x - 2}$", "$\\frac{x - 5}{x + 2}$", "$\\frac{x + 5}{x}$", "$x + 5$"]'::jsonb, '$\frac{x + 5}{x - 2}$', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Simplifica $\frac{x^3 + 3x^2 - 10x}{x^3 - 4x^2 + 4x}$' AND tipo = 'test' AND mundo_id = 2);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 2, 'test', 'Avanzado', 'Simplifica $\dfrac{\frac{1}{a} + \frac{1}{b}}{\frac{1}{a} - \frac{1}{b}}$', '["$\\frac{b + a}{b - a}$", "$\\frac{a + b}{a - b}$", "$1$", "$ab$"]'::jsonb, '$\frac{b + a}{b - a}$', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Simplifica $\dfrac{\frac{1}{a} + \frac{1}{b}}{\frac{1}{a} - \frac{1}{b}}$' AND tipo = 'test' AND mundo_id = 2);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 2, 'test', 'Avanzado', '¿Cuál es el error en $\frac{x^2 + 4}{x + 2} = x + 2$?', '["Ninguno, es correcto", "$x^2 + 4$ no se factoriza como $(x+2)^2$ ni $(x+2)(x-2)$", "Falta la restricción $x \\neq 2$", "Debería ser $x - 2$"]'::jsonb, '$x^2 + 4$ no se factoriza como $(x+2)^2$ ni $(x+2)(x-2)$', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Cuál es el error en $\frac{x^2 + 4}{x + 2} = x + 2$?' AND tipo = 'test' AND mundo_id = 2);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 3, 'test', 'Principiante', 'Resuelve $7x - 4 = 3x + 8$', '["$x = 3$", "$x = 1$", "$x = -3$", "$x = 12$"]'::jsonb, '$x = 3$', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Resuelve $7x - 4 = 3x + 8$' AND tipo = 'test' AND mundo_id = 3);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 3, 'test', 'Principiante', 'La suma de tres números pares consecutivos es 96. ¿Cuál es el menor?', '["30", "32", "28", "34"]'::jsonb, '30', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'La suma de tres números pares consecutivos es 96. ¿Cuál es el menor?' AND tipo = 'test' AND mundo_id = 3);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 3, 'test', 'Principiante', 'Resuelve $x^2 + 5x - 24 = 0$', '["$x = 3$ o $x = -8$", "$x = -3$ o $x = 8$", "$x = 4$ o $x = -6$", "$x = 3$"]'::jsonb, '$x = 3$ o $x = -8$', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Resuelve $x^2 + 5x - 24 = 0$' AND tipo = 'test' AND mundo_id = 3);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 3, 'test', 'Intermedio', '¿Cuántas soluciones reales tiene $4x^2 + 12x + 9 = 0$?', '["Ninguna", "Una", "Dos", "Infinitas"]'::jsonb, 'Una', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Cuántas soluciones reales tiene $4x^2 + 12x + 9 = 0$?' AND tipo = 'test' AND mundo_id = 3);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 3, 'test', 'Intermedio', 'Resuelve $(x - 1)^2 = 3$', '["$x = 1 \\pm \\sqrt{3}$", "$x = 4$", "$x = \\pm\\sqrt{3}$", "$x = 1 + \\sqrt{3}$"]'::jsonb, '$x = 1 \pm \sqrt{3}$', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Resuelve $(x - 1)^2 = 3$' AND tipo = 'test' AND mundo_id = 3);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 3, 'test', 'Intermedio', 'Con $m = -0{,}875x + 190$, ¿qué edad tiene una persona con ritmo máximo de 160 latidos por minuto?', '["Aproximadamente 34 años", "50 años", "Aproximadamente 46 años", "30 años"]'::jsonb, 'Aproximadamente 34 años', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Con $m = -0{,}875x + 190$, ¿qué edad tiene una persona con ritmo máximo de 160 latidos por minuto?' AND tipo = 'test' AND mundo_id = 3);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 3, 'test', 'Avanzado', 'Los lados de un triángulo rectángulo son tres enteros consecutivos. ¿Cuánto mide la hipotenusa?', '["5", "4", "13", "6"]'::jsonb, '5', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Los lados de un triángulo rectángulo son tres enteros consecutivos. ¿Cuánto mide la hipotenusa?' AND tipo = 'test' AND mundo_id = 3);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 3, 'test', 'Avanzado', '¿Para qué valores de $a$ la ecuación $4x^2 + 2ax + 1 = 0$ tiene una sola solución real?', '["$a = \\pm 2$", "$a = 2$", "$a = \\pm 4$", "$a = 0$"]'::jsonb, '$a = \pm 2$', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Para qué valores de $a$ la ecuación $4x^2 + 2ax + 1 = 0$ tiene una sola solución real?' AND tipo = 'test' AND mundo_id = 3);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 3, 'test', 'Avanzado', 'En $ax^2 + bx + c = 0$, ¿cuánto vale la suma de las soluciones?', '["$-\\frac{b}{a}$", "$\\frac{b}{a}$", "$\\frac{c}{a}$", "$-\\frac{c}{a}$"]'::jsonb, '$-\frac{b}{a}$', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'En $ax^2 + bx + c = 0$, ¿cuánto vale la suma de las soluciones?' AND tipo = 'test' AND mundo_id = 3);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 4, 'test', 'Principiante', 'Distancia entre $A(-1, 2)$ y $B(3, 5)$', '["5", "7", "$\\sqrt{7}$", "25"]'::jsonb, '5', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Distancia entre $A(-1, 2)$ y $B(3, 5)$' AND tipo = 'test' AND mundo_id = 4);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 4, 'test', 'Principiante', 'Pendiente de la recta que pasa por $(1, 2)$ y $(3, 6)$', '["2", "$\\frac{1}{2}$", "4", "−2"]'::jsonb, '2', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Pendiente de la recta que pasa por $(1, 2)$ y $(3, 6)$' AND tipo = 'test' AND mundo_id = 4);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 4, 'test', 'Principiante', '¿Cuál es el vértice de $y = 2(x - 1)^2 - 8$?', '["$(1, -8)$", "$(-1, -8)$", "$(1, 8)$", "$(2, -8)$"]'::jsonb, '$(1, -8)$', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Cuál es el vértice de $y = 2(x - 1)^2 - 8$?' AND tipo = 'test' AND mundo_id = 4);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 4, 'test', 'Intermedio', 'Centro y radio de $(x + 2)^2 + (y - 1)^2 = 4$', '["Centro $(-2, 1)$, radio 2", "Centro $(2, -1)$, radio 2", "Centro $(-2, 1)$, radio 4", "Centro $(2, -1)$, radio 4"]'::jsonb, 'Centro $(-2, 1)$, radio 2', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Centro y radio de $(x + 2)^2 + (y - 1)^2 = 4$' AND tipo = 'test' AND mundo_id = 4);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 4, 'test', 'Intermedio', 'Pendiente de una recta perpendicular a $y = \frac{3}{2}x + 3$', '["$-\\frac{2}{3}$", "$\\frac{2}{3}$", "$-\\frac{3}{2}$", "$\\frac{3}{2}$"]'::jsonb, '$-\frac{2}{3}$', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Pendiente de una recta perpendicular a $y = \frac{3}{2}x + 3$' AND tipo = 'test' AND mundo_id = 4);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 4, 'test', 'Intermedio', 'Ceros de $y = x^2 - 4x + 3$', '["$x = 1$ y $x = 3$", "$x = -1$ y $x = -3$", "$x = 2$", "No tiene ceros reales"]'::jsonb, '$x = 1$ y $x = 3$', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Ceros de $y = x^2 - 4x + 3$' AND tipo = 'test' AND mundo_id = 4);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 4, 'test', 'Avanzado', 'Distancia del punto $(1, 2)$ a la recta $3x + 4y - 1 = 0$', '["2", "10", "$\\frac{10}{7}$", "$\\sqrt{10}$"]'::jsonb, '2', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Distancia del punto $(1, 2)$ a la recta $3x + 4y - 1 = 0$' AND tipo = 'test' AND mundo_id = 4);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 4, 'test', 'Avanzado', 'Un balón sigue $y = -\frac{1}{5}x^2 + 2x$ (en metros). ¿Cuál es su altura máxima?', '["5 m", "10 m", "2 m", "4 m"]'::jsonb, '5 m', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Un balón sigue $y = -\frac{1}{5}x^2 + 2x$ (en metros). ¿Cuál es su altura máxima?' AND tipo = 'test' AND mundo_id = 4);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 4, 'test', 'Avanzado', '¿Qué curva describe $x^2 + y^2 - 6x + 4y - 3 = 0$?', '["Circunferencia de centro $(3, -2)$ y radio 4", "Circunferencia de centro $(-3, 2)$ y radio 4", "Circunferencia de centro $(3, -2)$ y radio 16", "Una parábola"]'::jsonb, 'Circunferencia de centro $(3, -2)$ y radio 4', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Qué curva describe $x^2 + y^2 - 6x + 4y - 3 = 0$?' AND tipo = 'test' AND mundo_id = 4);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 5, 'test', 'Principiante', 'Los catetos de un triángulo rectángulo miden 3 y 4. ¿Cuánto mide la hipotenusa?', '["5", "7", "25", "12"]'::jsonb, '5', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Los catetos de un triángulo rectángulo miden 3 y 4. ¿Cuánto mide la hipotenusa?' AND tipo = 'test' AND mundo_id = 5);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 5, 'test', 'Principiante', 'Área de un círculo de radio 3 cm', '["$9\\pi$ cm²", "$6\\pi$ cm²", "$3\\pi$ cm²", "$9\\pi$ cm"]'::jsonb, '$9\pi$ cm²', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Área de un círculo de radio 3 cm' AND tipo = 'test' AND mundo_id = 5);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 5, 'test', 'Principiante', '¿Es rectángulo el triángulo de lados 6, 8 y 11?', '["No, porque $6^2 + 8^2 \\neq 11^2$", "Sí, porque $6 + 8 > 11$", "Sí, por Pitágoras", "No se puede saber"]'::jsonb, 'No, porque $6^2 + 8^2 \neq 11^2$', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Es rectángulo el triángulo de lados 6, 8 y 11?' AND tipo = 'test' AND mundo_id = 5);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 5, 'test', 'Intermedio', 'Volumen de una lata cilíndrica de radio 3 cm y altura 10 cm', '["$90\\pi$ cm³", "$30\\pi$ cm³", "$60\\pi$ cm³", "$900\\pi$ cm³"]'::jsonb, '$90\pi$ cm³', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Volumen de una lata cilíndrica de radio 3 cm y altura 10 cm' AND tipo = 'test' AND mundo_id = 5);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 5, 'test', 'Intermedio', 'Si se duplica el lado de un cuadrado, su área…', '["se cuadruplica", "se duplica", "se triplica", "no cambia"]'::jsonb, 'se cuadruplica', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Si se duplica el lado de un cuadrado, su área…' AND tipo = 'test' AND mundo_id = 5);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 5, 'test', 'Intermedio', 'Un terreno cuadrado tiene 44.100 m². ¿Cuántos metros de cerca necesita?', '["840 m", "210 m", "420 m", "11.025 m"]'::jsonb, '840 m', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Un terreno cuadrado tiene 44.100 m². ¿Cuántos metros de cerca necesita?' AND tipo = 'test' AND mundo_id = 5);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 5, 'test', 'Avanzado', '¿Cabe una varilla de 1,25 m en una caja de 30 × 40 × 120 cm?', '["Sí, la diagonal mide 130 cm", "No, la diagonal mide 120 cm", "No, la diagonal mide 50 cm", "Sí, la diagonal mide 190 cm"]'::jsonb, 'Sí, la diagonal mide 130 cm', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Cabe una varilla de 1,25 m en una caja de 30 × 40 × 120 cm?' AND tipo = 'test' AND mundo_id = 5);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 5, 'test', 'Avanzado', '¿Por qué factor se multiplican las aristas de un cubo para que su volumen se multiplique por 27?', '["3", "9", "27", "$\\sqrt{27}$"]'::jsonb, '3', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = '¿Por qué factor se multiplican las aristas de un cubo para que su volumen se multiplique por 27?' AND tipo = 'test' AND mundo_id = 5);
INSERT INTO niv_banco.pregunta (mundo_id, tipo, dificultad, enunciado, alternativas, correcta, creado_por)
  SELECT 5, 'test', 'Avanzado', 'Una encomienda cúbica de 27.000 cm³ se cobra 9.000 pesos por metro lineal (largo + ancho + alto). ¿Cuánto cuesta?', '["8.100 pesos", "2.700 pesos", "24.300 pesos", "9.000 pesos"]'::jsonb, '8.100 pesos', 'muestra'
  WHERE NOT EXISTS (SELECT 1 FROM niv_banco.pregunta WHERE enunciado = 'Una encomienda cúbica de 27.000 cm³ se cobra 9.000 pesos por metro lineal (largo + ancho + alto). ¿Cuánto cuesta?' AND tipo = 'test' AND mundo_id = 5);
