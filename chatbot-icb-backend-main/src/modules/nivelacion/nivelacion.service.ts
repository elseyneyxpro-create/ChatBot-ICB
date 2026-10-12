import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { PostgresService } from '../../database/postgres.service';
import { MongoService } from '../../database/mongo.service';
import { AiService } from '../ai/ai.service';
import { AccesoService } from './acceso.service';
import { NIVELES, Nivel } from './nivelacion.dto';


/** Reglas del juego (las mismas de la maqueta). */
export const REGLAS = {
  FASES_POR_NODO: 4,
  PREGUNTAS_POR_FASE: 4,
  PREGUNTAS_POR_TEST: 10,
  PUNTAJE_APROBAR: 70,
  XP_FASE: 10,
  XP_TEST_FASE_1: 250,
  XP_TEST_FASE_2: 500,
  XP_ENTRENAR: 5,
  ANALIZAR_CADA_N_ENTRENAMIENTOS: 5,
  XP_POR_NIVEL: 100,
};

type Usuario = { uid: string; email: string };
type PreguntaBanco = {
  id: number; mundo_id: number | null; nodo_id: number | null; dificultad: string;
  enunciado: string; alternativas: string[]; correcta: string; explicacion: string | null;
};

const siguienteNivel = (n: Nivel): Nivel => NIVELES[Math.min(NIVELES.indexOf(n) + 1, NIVELES.length - 1)];
const shuffle = <T>(a: T[]): T[] => {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
};
/** Lo que ve el alumno: sin respuesta correcta ni explicación. */
const publica = (p: PreguntaBanco) => ({ id: p.id, enunciado: p.enunciado, alternativas: p.alternativas });

@Injectable()
export class NivelacionService {
  private readonly logger = new Logger(NivelacionService.name);

  constructor(
    private readonly pg: PostgresService,
    private readonly mongo: MongoService,
    private readonly ai: AiService,
    private readonly acceso: AccesoService,
  ) {}

  // ── Estudiante ───────────────────────────────────────────────────────────

  /**
   * Crea/lee el estudiante. El nivel NO lo elige el alumno: la primera vez se toma de
   * whitelist_alumnos.nivel_inicial (lo cargan los profesores) y después lo ajusta el agente analista.
   */
  private async estudiante(u: Usuario) {
    return this.pg.queryOne<{ uid: string; nivel: Nivel; xp: number; entrenamientos: number }>(
      `INSERT INTO niv_progreso.estudiante (uid, correo, nivel)
       VALUES ($1, $2, COALESCE(
         (SELECT nivel_inicial FROM whitelist_alumnos WHERE lower(email) = $2 ORDER BY activo DESC LIMIT 1),
         'Principiante'))
       ON CONFLICT (uid) DO UPDATE
         SET correo = EXCLUDED.correo,
             nivel  = COALESCE(niv_progreso.estudiante.nivel, EXCLUDED.nivel)
       RETURNING uid, nivel, xp, entrenamientos`,
      [u.uid, u.email?.toLowerCase() ?? null],
    );
  }

  private async nivelRequerido(u: Usuario): Promise<Nivel> {
    return (await this.estudiante(u)).nivel;
  }

  private async sumarXp(uid: string, xp: number) {
    if (xp > 0) await this.pg.query('UPDATE niv_progreso.estudiante SET xp = xp + $2, updated_at = now() WHERE uid = $1', [uid, xp]);
  }

  // ── Mapa ─────────────────────────────────────────────────────────────────

  async estado(u: Usuario) {
    const e = await this.estudiante(u);
    const mundos = await this.pg.query(
      `SELECT m.id, m.orden, m.titulo, m.descripcion, m.icono,
              count(n.id)::int AS total_nodos,
              count(pn.nodo_id) FILTER (WHERE pn.fases >= $2)::int AS nodos_completados,
              COALESCE(max(pt.fase), 0)::int AS fase_test
         FROM niv_banco.mundo m
         LEFT JOIN niv_banco.nodo n ON n.mundo_id = m.id
         LEFT JOIN niv_progreso.progreso_nodo pn ON pn.nodo_id = n.id AND pn.uid = $1
         LEFT JOIN niv_progreso.progreso_test pt ON pt.mundo_id = m.id AND pt.uid = $1
        WHERE m.activo
        GROUP BY m.id ORDER BY m.orden`,
      [u.uid, REGLAS.FASES_POR_NODO],
    );
    // Un mundo se desbloquea cuando todos los anteriores están completados (test fase 2)
    let anterioresCompletos = true;
    const lista = mundos.map((m: any) => {
      const completado = m.fase_test >= 2;
      const r = { ...m, completado, desbloqueado: anterioresCompletos };
      anterioresCompletos = anterioresCompletos && completado;
      return r;
    });
    const analisis = await this.ultimoAnalisis(u.uid);
    return {
      estudiante: {
        nivel: e.nivel,
        xp: e.xp,
        nivel_xp: Math.floor(e.xp / REGLAS.XP_POR_NIVEL) + 1,
        xp_en_nivel: e.xp % REGLAS.XP_POR_NIVEL,
        xp_por_nivel: REGLAS.XP_POR_NIVEL,
        chatbot_habilitado: await this.acceso.chatbotHabilitado(u.email),
        nivelacion_completa: lista.length > 0 && lista.every((m) => m.completado),
      },
      mundos: lista,
      analisis,
    };
  }

  private async mundoDesbloqueado(u: Usuario, mundoId: number) {
    const { mundos } = await this.estado(u);
    const m = mundos.find((x: any) => x.id === mundoId);
    if (!m) throw new NotFoundException('Mundo no encontrado.');
    if (!m.desbloqueado) throw new ForbiddenException('Este mundo todavía está bloqueado.');
    return m;
  }

  async mundo(u: Usuario, mundoId: number) {
    const m = await this.mundoDesbloqueado(u, mundoId);
    const nodos = await this.pg.query(
      `SELECT n.id, n.orden, n.titulo, n.descripcion, COALESCE(pn.fases, 0)::int AS fases
         FROM niv_banco.nodo n
         LEFT JOIN niv_progreso.progreso_nodo pn ON pn.nodo_id = n.id AND pn.uid = $2
        WHERE n.mundo_id = $1 ORDER BY n.orden`,
      [mundoId, u.uid],
    );
    // Nodo actual = el primero no completado; los siguientes quedan bloqueados
    const idxActual = nodos.findIndex((n: any) => n.fases < REGLAS.FASES_POR_NODO);
    const lista = nodos.map((n: any, i: number) => ({
      ...n,
      estado: n.fases >= REGLAS.FASES_POR_NODO ? 'completado' : i === idxActual ? 'actual' : 'bloqueado',
    }));
    return {
      mundo: { id: m.id, titulo: m.titulo, descripcion: m.descripcion, icono: m.icono, completado: m.completado },
      nodos: lista,
      test: { fase: m.fase_test, desbloqueado: idxActual === -1 && lista.length > 0 },
      reglas: REGLAS,
    };
  }

  private async nodoInfo(u: Usuario, nodoId: number, permitir: ('actual' | 'completado')[]) {
    const n = await this.pg.queryOne<{ id: number; mundo_id: number; titulo: string }>(
      'SELECT id, mundo_id, titulo FROM niv_banco.nodo WHERE id = $1', [nodoId],
    );
    if (!n) throw new NotFoundException('Nodo no encontrado.');
    const { nodos, mundo } = await this.mundo(u, n.mundo_id);
    const nodo = nodos.find((x: any) => x.id === nodoId);
    if (!permitir.includes(nodo.estado)) throw new ForbiddenException('Este nodo todavía está bloqueado.');
    return { ...nodo, mundo_id: n.mundo_id, mundo_titulo: mundo.titulo };
  }

  // ── Preguntas del banco ──────────────────────────────────────────────────

  /** Preguntas de práctica para un nodo: primero las del nodo, luego las del mundo, luego las generales. */
  private async poolNodo(mundoId: number, nodoId: number, dificultad: Nivel): Promise<PreguntaBanco[]> {
    return this.pg.query<PreguntaBanco>(
      `SELECT id, mundo_id, nodo_id, dificultad, enunciado, alternativas, correcta, explicacion
         FROM niv_banco.pregunta
        WHERE activa AND tipo = 'nodo' AND dificultad = $3
          AND (nodo_id = $2 OR (nodo_id IS NULL AND (mundo_id = $1 OR mundo_id IS NULL)))
        ORDER BY CASE WHEN nodo_id = $2 THEN 0 WHEN mundo_id = $1 THEN 1 ELSE 2 END, random()`,
      [mundoId, nodoId, dificultad],
    );
  }

  /** Preguntas del test: la fase 1 a tu nivel, la fase 2 un nivel más arriba. Completa con otros niveles si faltan. */
  private async poolTest(mundoId: number, fase: number, nivel: Nivel): Promise<PreguntaBanco[]> {
    const dif = fase === 1 ? nivel : siguienteNivel(nivel);
    return this.pg.query<PreguntaBanco>(
      `SELECT id, mundo_id, nodo_id, dificultad, enunciado, alternativas, correcta, explicacion
         FROM niv_banco.pregunta
        WHERE activa AND tipo = 'test' AND mundo_id = $1 AND (fase_test IS NULL OR fase_test = $2)
        ORDER BY (dificultad = $3) DESC, random()
        LIMIT $4`,
      [mundoId, fase, dif, REGLAS.PREGUNTAS_POR_TEST],
    );
  }

  /** Corrige en el servidor y registra cada respuesta como intento. */
  private async corregir(
    u: Usuario, contexto: 'fase' | 'test', validas: PreguntaBanco[],
    respuestas: { pregunta_id: number; respuesta: string }[], mundoId: number, nodoId: number | null,
  ) {
    const porId = new Map(validas.map((p) => [p.id, p]));
    const vistas = new Set<number>();
    const resultados: any[] = [];
    for (const r of respuestas) {
      const p = porId.get(r.pregunta_id);
      if (!p || vistas.has(r.pregunta_id)) throw new BadRequestException(`Pregunta ${r.pregunta_id} no válida para esta evaluación.`);
      vistas.add(r.pregunta_id);
      const es_correcto = r.respuesta === p.correcta;
      await this.pg.query(
        `INSERT INTO niv_progreso.intento
           (uid, origen, contexto, pregunta_id, mundo_id, nodo_id, dificultad, enunciado, alternativas, respuesta, correcta, es_correcto)
         VALUES ($1, 'banco', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [u.uid, contexto, p.id, mundoId, nodoId ?? p.nodo_id, p.dificultad, p.enunciado,
         JSON.stringify(p.alternativas), r.respuesta, p.correcta, es_correcto],
      );
      resultados.push({
        pregunta_id: p.id, enunciado: p.enunciado, respuesta: r.respuesta,
        es_correcto, correcta: p.correcta, explicacion: p.explicacion,
      });
    }
    const correctas = resultados.filter((r) => r.es_correcto).length;
    return { resultados, puntaje: Math.round((correctas / resultados.length) * 100) };
  }

  // ── Fases de nodo ────────────────────────────────────────────────────────

  async preguntasFase(u: Usuario, nodoId: number) {
    const nivel = await this.nivelRequerido(u);
    const nodo = await this.nodoInfo(u, nodoId, ['actual', 'completado']);
    const pool = await this.poolNodo(nodo.mundo_id, nodoId, nivel);
    if (!pool.length) throw new NotFoundException('Todavía no hay preguntas cargadas para este nodo y nivel.');
    return {
      nodo: { id: nodo.id, titulo: nodo.titulo, mundo_id: nodo.mundo_id, mundo_titulo: nodo.mundo_titulo },
      fase: Math.min(nodo.fases + 1, REGLAS.FASES_POR_NODO),
      repaso: nodo.estado === 'completado',
      preguntas: pool.slice(0, REGLAS.PREGUNTAS_POR_FASE).map(publica),
    };
  }

  async responderFase(u: Usuario, nodoId: number, respuestas: { pregunta_id: number; respuesta: string }[]) {
    const nivel = await this.nivelRequerido(u);
    const nodo = await this.nodoInfo(u, nodoId, ['actual', 'completado']);
    const pool = await this.poolNodo(nodo.mundo_id, nodoId, nivel);
    const esperadas = Math.min(REGLAS.PREGUNTAS_POR_FASE, pool.length);
    if (respuestas.length !== esperadas) throw new BadRequestException(`Se esperaban ${esperadas} respuestas.`);

    const { resultados, puntaje } = await this.corregir(u, 'fase', pool, respuestas, nodo.mundo_id, nodoId);
    const aprobado = puntaje >= REGLAS.PUNTAJE_APROBAR;
    const repaso = nodo.estado === 'completado';
    let fases = nodo.fases;
    let xp = 0;
    if (aprobado && !repaso) {
      fases = Math.min(nodo.fases + 1, REGLAS.FASES_POR_NODO);
      xp = REGLAS.XP_FASE;
      await this.pg.query(
        `INSERT INTO niv_progreso.progreso_nodo (uid, nodo_id, fases) VALUES ($1, $2, $3)
         ON CONFLICT (uid, nodo_id) DO UPDATE SET fases = GREATEST(niv_progreso.progreso_nodo.fases, EXCLUDED.fases), updated_at = now()`,
        [u.uid, nodoId, fases],
      );
      await this.sumarXp(u.uid, xp);
    }
    this.pedirAnalisis(u.uid);
    return { puntaje, aprobado, repaso, fases, nodo_completado: fases >= REGLAS.FASES_POR_NODO, xp_ganado: xp, resultados };
  }

  // ── Test del mundo ───────────────────────────────────────────────────────

  private async testInfo(u: Usuario, mundoId: number) {
    const info = await this.mundo(u, mundoId);
    if (!info.test.desbloqueado) throw new ForbiddenException('Completa todos los nodos para desbloquear el test.');
    if (info.test.fase >= 2) throw new BadRequestException('Ya completaste este mundo.');
    return { ...info, faseActual: info.test.fase + 1 };
  }

  async preguntasTest(u: Usuario, mundoId: number) {
    const nivel = await this.nivelRequerido(u);
    const info = await this.testInfo(u, mundoId);
    const pool = await this.poolTest(mundoId, info.faseActual, nivel);
    if (!pool.length) throw new NotFoundException('Todavía no hay preguntas de test para este mundo.');
    return { mundo: info.mundo, fase: info.faseActual, preguntas: pool.map(publica) };
  }

  async responderTest(u: Usuario, mundoId: number, respuestas: { pregunta_id: number; respuesta: string }[]) {
    await this.nivelRequerido(u);
    const info = await this.testInfo(u, mundoId);
    // Valida contra todas las preguntas de test del mundo para esta fase (el pool se sortea al pedirlas)
    const validas = await this.pg.query<PreguntaBanco>(
      `SELECT id, mundo_id, nodo_id, dificultad, enunciado, alternativas, correcta, explicacion
         FROM niv_banco.pregunta
        WHERE activa AND tipo = 'test' AND mundo_id = $1 AND (fase_test IS NULL OR fase_test = $2)`,
      [mundoId, info.faseActual],
    );
    const esperadas = Math.min(REGLAS.PREGUNTAS_POR_TEST, validas.length);
    if (respuestas.length !== esperadas) throw new BadRequestException(`Se esperaban ${esperadas} respuestas.`);

    const { resultados, puntaje } = await this.corregir(u, 'test', validas, respuestas, mundoId, null);
    const aprobado = puntaje >= REGLAS.PUNTAJE_APROBAR;
    let fase = info.test.fase;
    let xp = 0;
    if (aprobado) {
      fase = info.faseActual;
      xp = fase === 2 ? REGLAS.XP_TEST_FASE_2 : REGLAS.XP_TEST_FASE_1;
      await this.sumarXp(u.uid, xp);
    }
    await this.pg.query(
      `INSERT INTO niv_progreso.progreso_test (uid, mundo_id, fase, mejor_puntaje) VALUES ($1, $2, $3, $4)
       ON CONFLICT (uid, mundo_id) DO UPDATE
         SET fase = GREATEST(niv_progreso.progreso_test.fase, EXCLUDED.fase),
             mejor_puntaje = GREATEST(niv_progreso.progreso_test.mejor_puntaje, EXCLUDED.mejor_puntaje),
             updated_at = now()`,
      [u.uid, mundoId, fase, puntaje],
    );
    // ¿Completó TODOS los mundos? → se le habilita el chatbot (whitelist_alumnos.chatbot_habilitado = true)
    let chatbot_desbloqueado = false;
    if (aprobado && fase >= 2) {
      const { estudiante } = await this.estado(u);
      if (estudiante.nivelacion_completa) {
        chatbot_desbloqueado = await this.acceso.habilitarChatbot(u.email);
        if (chatbot_desbloqueado) this.logger.log(`Nivelación completa: chatbot habilitado para ${u.email}`);
      }
    }
    this.pedirAnalisis(u.uid);
    return { puntaje, aprobado, fase, mundo_completado: fase >= 2, chatbot_desbloqueado, xp_ganado: xp, resultados };
  }

  // ── Modo Entrenar (preguntas generadas por IA) ───────────────────────────

  private get generadas() { return this.mongo.col('niv_generadas'); }

  async generarPregunta(u: Usuario, nodoId: number) {
    const nivel = await this.nivelRequerido(u);
    const nodo = await this.nodoInfo(u, nodoId, ['actual', 'completado']);
    const ejemplos = (await this.poolNodo(nodo.mundo_id, nodoId, nivel)).slice(0, 3)
      .map((p) => ({ enunciado: p.enunciado, alternativas: p.alternativas, correcta: p.correcta }));

    const res = await this.ai.post('/niv/generar', {
      mundo: nodo.mundo_titulo, nodo: nodo.titulo, nivel, ejemplos,
    });
    if (!res?.ok || !res.pregunta) throw new BadRequestException('No se pudo generar una pregunta. Intenta de nuevo.');
    const p = res.pregunta as { enunciado: string; alternativas: string[]; correcta: string; explicacion?: string };

    // La pregunta generada vive solo temporalmente (TTL) hasta que el alumno responda:
    // NO entra al banco de preguntas de los profesores.
    // Limpieza por si el índice TTL no existe: borra las que tengan más de 2 horas.
    await this.generadas.deleteMany({ created_at: { $lt: new Date(Date.now() - 2 * 3600 * 1000) } });
    const id = this.mongo.newId();
    await this.generadas.insertOne({
      _id: id, uid: u.uid, nodo_id: nodoId, mundo_id: nodo.mundo_id, dificultad: nivel,
      enunciado: p.enunciado, alternativas: p.alternativas, correcta: p.correcta,
      explicacion: p.explicacion ?? null, created_at: new Date(),
    });
    return {
      id, enunciado: p.enunciado, alternativas: p.alternativas,
      nodo: { id: nodo.id, titulo: nodo.titulo, mundo_id: nodo.mundo_id, mundo_titulo: nodo.mundo_titulo },
    };
  }

  async responderGenerada(u: Usuario, id: string, respuesta: string) {
    const g: any = await this.generadas.findOneAndDelete({ _id: id, uid: u.uid });
    if (!g) throw new NotFoundException('La pregunta expiró o ya fue respondida. Genera una nueva.');
    const es_correcto = respuesta === g.correcta;
    await this.estudiante(u);
    await this.pg.query(
      `INSERT INTO niv_progreso.intento
         (uid, origen, contexto, mundo_id, nodo_id, dificultad, enunciado, alternativas, respuesta, correcta, es_correcto)
       VALUES ($1, 'generada', 'entrenar', $2, $3, $4, $5, $6, $7, $8, $9)`,
      [u.uid, g.mundo_id, g.nodo_id, g.dificultad, g.enunciado, JSON.stringify(g.alternativas), respuesta, g.correcta, es_correcto],
    );
    const xp = es_correcto ? REGLAS.XP_ENTRENAR : 0;
    await this.sumarXp(u.uid, xp);
    const { entrenamientos } = await this.pg.queryOne<{ entrenamientos: number }>(
      `UPDATE niv_progreso.estudiante SET entrenamientos = entrenamientos + 1 WHERE uid = $1 RETURNING entrenamientos`,
      [u.uid],
    );
    if (entrenamientos % REGLAS.ANALIZAR_CADA_N_ENTRENAMIENTOS === 0) this.pedirAnalisis(u.uid);
    return { es_correcto, correcta: g.correcta, explicacion: g.explicacion, xp_ganado: xp };
  }

  // ── Agente analista ──────────────────────────────────────────────────────

  async ultimoAnalisis(uid: string) {
    return this.pg.queryOne(
      `SELECT nivel_sugerido, fortalezas, debilidades, recomendacion, resumen, n_intentos, created_at
         FROM niv_progreso.analisis WHERE uid = $1 ORDER BY created_at DESC LIMIT 1`,
      [uid],
    );
  }

  /** Dispara el análisis en el servicio Python sin hacer esperar al alumno. */
  private pedirAnalisis(uid: string) {
    this.ai.post('/niv/analizar', { uid })
      .catch((e) => this.logger.warn(`No se pudo pedir el análisis de ${uid}: ${e?.message ?? e}`));
  }
}
