import {
  BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostgresService } from '../../database/postgres.service';
import { MongoService } from '../../database/mongo.service';
import { AiService } from '../ai/ai.service';
import { NivelacionService } from './nivelacion.service';
import { CrearSesionDto } from './tutor.dto';

type Usuario = { uid: string; email: string };
type Rol = 'alumno' | 'tutor' | 'evento';

interface EjercicioSesion {
  id: string;
  enunciado: string;
  alternativas: string[];
  respuesta?: string;
  es_correcto?: boolean;
  correcta?: string;
  explicacion?: string | null;
  revelado?: boolean;
  /** No se respondió antes de que venciera (las generadas duran 2 h) y ya no se puede responder. */
  vencido?: boolean;
}

interface MensajeSesion {
  id: string;
  rol: Rol;
  texto: string;
  at: Date;
  ejercicio_id?: string;
}

interface Sesion {
  _id: string;
  uid: string;
  nodo_id: number | null;
  mundo_id: number;
  modo: 'nodo' | 'revision';
  intento_ids: string[];
  mensajes: MensajeSesion[];
  ejercicios: EjercicioSesion[];
  created_at: Date;
  updated_at: Date;
}

interface IntentoRevision {
  id: string;
  enunciado: string;
  alternativas: string[] | null;
  respuesta: string | null;
  correcta: string | null;
  es_correcto: boolean;
  explicacion: string | null;
  contexto: string;
  dificultad: string | null;
  nodo_id: number | null;
  mundo_id: number | null;
}

/** Una conversación del mismo nodo se retoma si se usó hace menos de esto. */
const RETOMAR_MS = 24 * 3600 * 1000;
const ERRORES_RECIENTES = 5;

/**
 * "Aprende con el tutor": tutor socrático de la nivelación + retroalimentación de fases/tests.
 *
 * - Solo funciona FUERA de las evaluaciones (no se abre durante una fase o un test) y lo que pase
 *   aquí no cuenta para el nivel/ELO, igual que el antiguo modo Entrenar.
 * - El tutor conoce el mundo, el nodo, la guía del cuaderno, el nivel del alumno, sus errores
 *   recientes y, si viene desde el resultado de una fase, las preguntas que respondió mal.
 * - Conversaciones en Mongo (niv_tutor); uso diario en niv_tutor_uso.
 */
@Injectable()
export class TutorService {
  private readonly logger = new Logger(TutorService.name);
  private readonly limiteDiario: number;

  constructor(
    private readonly pg: PostgresService,
    private readonly mongo: MongoService,
    private readonly ai: AiService,
    private readonly niv: NivelacionService,
    cfg: ConfigService,
  ) {
    this.limiteDiario = Number(cfg.get('TUTOR_LIMITE_DIARIO') ?? 80);
  }

  private get sesiones() { return this.mongo.col<Sesion>('niv_tutor'); }
  private get uso() { return this.mongo.col<{ n: number }>('niv_tutor_uso'); }
  private get retros() { return this.mongo.col('niv_retro'); }

  // ── Límite diario ─────────────────────────────────────────────────────────

  private claveUso(uid: string) {
    const hoy = new Date().toLocaleDateString('sv', { timeZone: 'America/Santiago' });
    return `${uid}:${hoy}`;
  }

  private async usados(uid: string) {
    const d = await this.uso.findOne({ _id: this.claveUso(uid) });
    return d?.n ?? 0;
  }

  private async verificarLimite(uid: string) {
    if ((await this.usados(uid)) >= this.limiteDiario) {
      throw new HttpException(
        { code: 'TUTOR_LIMITE', message: 'Llegaste al límite de mensajes con el tutor por hoy. Vuelve mañana.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async contarUso(uid: string) {
    await this.uso.updateOne({ _id: this.claveUso(uid) }, { $inc: { n: 1 } }, { upsert: true });
  }

  // ── Datos del alumno y del nodo ───────────────────────────────────────────

  /**
   * Nivel del alumno para adaptar las pistas. Lee la fila completa como JSON para no depender de
   * columnas fijas: cuando el sistema ELO agregue `elo` (u otra columna) a niv_progreso.estudiante,
   * el tutor la recibe sin cambiar este código.
   */
  private async perfil(u: Usuario): Promise<{ nivel: string; elo: number | null }> {
    await this.niv.estudiante(u); // crea la fila si es la primera vez
    const row = await this.pg.queryOne<{ e: Record<string, unknown> }>(
      'SELECT to_jsonb(e) AS e FROM niv_progreso.estudiante e WHERE uid = $1', [u.uid],
    );
    const e = row?.e ?? {};
    const elo = e['elo'];
    return { nivel: String(e['nivel'] ?? 'Principiante'), elo: typeof elo === 'number' ? elo : elo != null ? Number(elo) : null };
  }

  private async intentosDelAlumno(uid: string, ids: string[]): Promise<IntentoRevision[]> {
    if (!ids.length) return [];
    const filas = await this.pg.query<IntentoRevision>(
      `SELECT i.id::text AS id, i.enunciado, i.alternativas, i.respuesta, i.correcta, i.es_correcto,
              p.explicacion, i.contexto, i.dificultad, i.nodo_id, i.mundo_id
         FROM niv_progreso.intento i
         LEFT JOIN niv_banco.pregunta p ON p.id = i.pregunta_id
        WHERE i.uid = $1 AND i.id = ANY($2::bigint[])`,
      [uid, ids],
    );
    if (filas.length !== new Set(ids).size) throw new NotFoundException('No se encontraron esas respuestas.');
    const orden = new Map(ids.map((id, i) => [id, i]));
    return filas.sort((a, b) => (orden.get(a.id) ?? 0) - (orden.get(b.id) ?? 0));
  }

  private async contexto(u: Usuario, s: Sesion) {
    const [perfil, nodo, mundo, analisis, revisar] = await Promise.all([
      this.perfil(u),
      s.nodo_id
        ? this.pg.queryOne<{ titulo: string; descripcion: string | null; guia: string | null }>(
          'SELECT titulo, descripcion, guia FROM niv_banco.nodo WHERE id = $1', [s.nodo_id])
        : Promise.resolve(null),
      this.pg.queryOne<{ titulo: string }>('SELECT titulo FROM niv_banco.mundo WHERE id = $1', [s.mundo_id]),
      this.niv.ultimoAnalisis(u.uid),
      this.intentosDelAlumno(u.uid, s.intento_ids),
    ]);
    const errores = s.nodo_id
      ? await this.pg.query(
        `SELECT enunciado, alternativas, respuesta, correcta, es_correcto
           FROM niv_progreso.intento
          WHERE uid = $1 AND nodo_id = $2 AND NOT es_correcto AND NOT (id = ANY($3::bigint[]))
          ORDER BY created_at DESC LIMIT ${ERRORES_RECIENTES}`,
        [u.uid, s.nodo_id, s.intento_ids])
      : [];
    const ultimo = s.ejercicios.at(-1);
    const ej = ultimo && !ultimo.vencido ? ultimo : undefined;
    return {
      mundo: mundo?.titulo ?? null,
      nodo: nodo?.titulo ?? (s.nodo_id ? null : 'Test del mundo'),
      nodo_descripcion: nodo?.descripcion ?? null,
      guia: nodo?.guia ?? null,
      nivel: perfil.nivel,
      elo: perfil.elo,
      debilidades: (analisis?.debilidades as string[] | undefined) ?? [],
      errores_recientes: errores,
      revisar,
      ejercicio: ej ?? null,
    };
  }

  // ── Llamada al agente ─────────────────────────────────────────────────────

  private async pedirAlTutor(u: Usuario, s: Sesion, mensaje: string | null): Promise<string | null> {
    try {
      const historial = s.mensajes.map((m) => ({ rol: m.rol, texto: m.texto }));
      const res = await this.ai.post('/niv/tutor', { contexto: await this.contexto(u, s), historial, mensaje });
      if (res?.ok && typeof res.respuesta === 'string' && res.respuesta.trim()) return res.respuesta.trim();
      this.logger.warn(`Tutor sin respuesta: ${res?.error ?? 'vacía'}`);
    } catch (e: any) {
      this.logger.warn(`Tutor falló: ${e?.message ?? e}`);
    }
    return null;
  }

  private msg(rol: Rol, texto: string, ejercicio_id?: string): MensajeSesion {
    return { id: this.mongo.newId(), rol, texto, at: new Date(), ...(ejercicio_id ? { ejercicio_id } : {}) };
  }

  private async guardar(s: Sesion, nuevos: MensajeSesion[], cambios: Partial<Sesion> = {}) {
    s.mensajes.push(...nuevos);
    Object.assign(s, cambios);
    await this.sesiones.updateOne(
      { _id: s._id },
      { $push: { mensajes: { $each: nuevos } } as any, $set: { ...cambios, updated_at: new Date() } as any },
    );
  }

  private async sesion(u: Usuario, id: string): Promise<Sesion> {
    const s = await this.sesiones.findOne({ _id: id, uid: u.uid });
    if (!s) throw new NotFoundException('Conversación no encontrada.');
    return s as Sesion;
  }

  /** Ejercicio que el alumno todavía puede responder. */
  private pendiente(e: EjercicioSesion) {
    return e.respuesta === undefined && !e.vencido;
  }

  /**
   * Marca como vencidos los ejercicios pendientes cuya pregunta generada ya expiró. Sin esto, una
   * conversación retomada horas después quedaba trabada: no se podía responder ni pedir otro.
   */
  private async revisarVencidos(u: Usuario, s: Sesion) {
    let cambio = false;
    for (const e of s.ejercicios) {
      if (this.pendiente(e) && !(await this.niv.generadaVigente(u, e.id))) {
        e.vencido = true;
        cambio = true;
      }
    }
    if (cambio) await this.guardar(s, [], { ejercicios: s.ejercicios });
  }

  // ── Vista para el frontend (sin respuestas correctas ocultas ni eventos internos) ──

  private vistaEjercicio(e: EjercicioSesion) {
    const mostrar = e.es_correcto === true || e.revelado === true;
    return {
      id: e.id, enunciado: e.enunciado, alternativas: e.alternativas,
      respuesta: e.respuesta ?? null, es_correcto: e.es_correcto ?? null, revelado: !!e.revelado,
      vencido: !!e.vencido,
      correcta: mostrar ? e.correcta ?? null : null,
      explicacion: mostrar ? e.explicacion ?? null : null,
    };
  }

  private vistaMensajes(s: Sesion, msgs: MensajeSesion[]) {
    const ej = new Map(s.ejercicios.map((e) => [e.id, e]));
    return msgs.filter((m) => m.rol !== 'evento').map((m) => ({
      id: m.id, rol: m.rol, texto: m.texto, at: m.at,
      ejercicio: m.ejercicio_id && ej.get(m.ejercicio_id) ? this.vistaEjercicio(ej.get(m.ejercicio_id)!) : null,
    }));
  }

  private async vista(u: Usuario, s: Sesion) {
    await this.revisarVencidos(u, s);
    const [nodo, mundo, usados] = await Promise.all([
      s.nodo_id ? this.pg.queryOne<{ id: number; titulo: string; orden: number }>(
        'SELECT id, titulo, orden FROM niv_banco.nodo WHERE id = $1', [s.nodo_id]) : Promise.resolve(null),
      this.pg.queryOne<{ id: number; titulo: string }>('SELECT id, titulo FROM niv_banco.mundo WHERE id = $1', [s.mundo_id]),
      this.usados(u.uid),
    ]);
    return {
      id: s._id, modo: s.modo, nodo, mundo,
      revisando: s.intento_ids.length,
      mensajes: this.vistaMensajes(s, s.mensajes),
      restantes_hoy: Math.max(this.limiteDiario - usados, 0),
    };
  }

  // ── Casos de uso ──────────────────────────────────────────────────────────

  async crear(u: Usuario, dto: CrearSesionDto) {
    const ids = [...new Set(dto.intento_ids ?? [])];
    const revisar = await this.intentosDelAlumno(u.uid, ids);

    // Nodo y mundo: los da el cliente o salen de las respuestas a revisar
    let nodoId = dto.nodo_id ?? revisar.find((r) => r.nodo_id)?.nodo_id ?? null;
    let mundoId = dto.mundo_id ?? revisar.find((r) => r.mundo_id)?.mundo_id ?? null;
    if (nodoId) {
      // El tutor se abre sobre nodos ya alcanzados (actual o completado), nunca sobre uno bloqueado
      const nodo = await this.niv.nodoInfo(u, nodoId, ['actual', 'completado']);
      mundoId = nodo.mundo_id;
    } else if (mundoId) {
      const { mundos } = await this.niv.estado(u);
      if (!mundos.find((m: any) => m.id === mundoId && m.desbloqueado)) throw new ForbiddenException('Este mundo todavía está bloqueado.');
    } else {
      throw new BadRequestException('Indica el nodo o las respuestas a revisar.');
    }
    if (revisar.some((r) => (r.nodo_id && r.nodo_id !== nodoId) || (r.mundo_id && r.mundo_id !== mundoId))) {
      throw new BadRequestException('Las respuestas a revisar deben ser del mismo nodo o test.');
    }

    // Retomar la conversación reciente del mismo nodo (si no viene a revisar algo puntual)
    if (!ids.length && !dto.nueva && nodoId) {
      const previa = await this.sesiones.find({ uid: u.uid, nodo_id: nodoId, modo: 'nodo' })
        .sort({ updated_at: -1 }).limit(1).next();
      if (previa && Date.now() - new Date(previa.updated_at).getTime() < RETOMAR_MS) return this.vista(u, previa as Sesion);
    }

    await this.verificarLimite(u.uid);
    const s: Sesion = {
      _id: this.mongo.newId(), uid: u.uid, nodo_id: nodoId, mundo_id: mundoId!,
      modo: ids.length ? 'revision' : 'nodo', intento_ids: ids,
      mensajes: [], ejercicios: [], created_at: new Date(), updated_at: new Date(),
    };
    await this.sesiones.insertOne(s);
    const saludo = await this.pedirAlTutor(u, s, null);
    await this.contarUso(u.uid);
    await this.guardar(s, [this.msg('tutor', saludo ?? (ids.length
      ? '¡Hola! Revisemos juntos lo que te costó. Elige una pregunta y cuéntame cómo la pensaste.'
      : '¡Hola! ¿Qué te gustaría practicar de este nodo? Si quieres, te propongo un ejercicio para empezar.'))]);
    return this.vista(u, s);
  }

  async obtener(u: Usuario, id: string) {
    return this.vista(u, await this.sesion(u, id));
  }

  async mensaje(u: Usuario, id: string, texto: string) {
    const s = await this.sesion(u, id);
    await this.verificarLimite(u.uid);
    const respuesta = await this.pedirAlTutor(u, s, texto.trim());
    if (!respuesta) {
      throw new HttpException(
        { code: 'TUTOR_NO_DISPONIBLE', message: 'El tutor no pudo responder ahora. Intenta de nuevo en un momento.' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    await this.contarUso(u.uid);
    const nuevos = [this.msg('alumno', texto.trim()), this.msg('tutor', respuesta)];
    await this.guardar(s, nuevos);
    return { mensajes: this.vistaMensajes(s, nuevos), restantes_hoy: Math.max(this.limiteDiario - (await this.usados(u.uid)), 0) };
  }

  /** El tutor propone un ejercicio del nodo (generado por IA, no entra al banco). */
  async ejercicio(u: Usuario, id: string) {
    const s = await this.sesion(u, id);
    if (!s.nodo_id) throw new BadRequestException('Los ejercicios se piden desde un nodo.');
    await this.revisarVencidos(u, s);
    if (s.ejercicios.some((e) => this.pendiente(e))) {
      throw new BadRequestException('Primero responde el ejercicio que tienes pendiente.');
    }
    await this.verificarLimite(u.uid);
    const g = await this.niv.generarPregunta(u, s.nodo_id);
    await this.contarUso(u.uid);
    const ej: EjercicioSesion = { id: g.id, enunciado: g.enunciado, alternativas: g.alternativas };
    s.ejercicios.push(ej);
    const nuevo = this.msg('tutor',
      'Te propongo este ejercicio. Intenta resolverlo y elige una alternativa; si te trabas, cuéntame cómo lo estás pensando.',
      ej.id);
    await this.guardar(s, [nuevo], { ejercicios: s.ejercicios });
    return { mensajes: this.vistaMensajes(s, [nuevo]) };
  }

  async responderEjercicio(u: Usuario, id: string, ejId: string, respuesta: string) {
    const s = await this.sesion(u, id);
    const ej = s.ejercicios.find((e) => e.id === ejId);
    if (!ej) throw new NotFoundException('Ejercicio no encontrado.');
    if (ej.respuesta !== undefined) throw new BadRequestException('Ya respondiste este ejercicio.');
    if (ej.vencido) throw this.vencido();
    if (!ej.alternativas.includes(respuesta)) throw new BadRequestException('Alternativa no válida.');

    // Registra el intento (origen "generada": suma XP y alimenta al analista, no cuenta para el nivel/ELO)
    let r: Awaited<ReturnType<NivelacionService['responderGenerada']>>;
    try {
      r = await this.niv.responderGenerada(u, ejId, respuesta);
    } catch (e) {
      if (!(e instanceof NotFoundException)) throw e;
      ej.vencido = true; // la pregunta generada expiró entre medio
      await this.guardar(s, [], { ejercicios: s.ejercicios });
      throw this.vencido();
    }
    Object.assign(ej, { respuesta, es_correcto: r.es_correcto, correcta: r.correcta, explicacion: r.explicacion });

    const evento = this.msg('evento', r.es_correcto
      ? `El estudiante respondió «${respuesta}» al ejercicio y es CORRECTA. Confírmalo y pídele que justifique o propón una extensión.`
      : `El estudiante respondió «${respuesta}» al ejercicio y es INCORRECTA. No reveles la correcta: guíalo con una pregunta para que encuentre su error.`,
      ej.id);
    await this.guardar(s, [evento], { ejercicios: s.ejercicios });

    let texto: string | null = null;
    if ((await this.usados(u.uid)) < this.limiteDiario) {
      texto = await this.pedirAlTutor(u, { ...s, mensajes: s.mensajes.slice(0, -1) }, `(Aviso de la plataforma) ${evento.texto}`);
      if (texto) await this.contarUso(u.uid);
    }
    const tutor = this.msg('tutor', texto ?? (r.es_correcto
      ? '¡Correcto! ¿Me cuentas por qué elegiste esa alternativa?'
      : 'No es la correcta, pero vamos bien. ¿Qué paso hiciste primero? Revisemos juntos.'));
    await this.guardar(s, [tutor]);
    return {
      es_correcto: r.es_correcto, xp_ganado: r.xp_ganado,
      ejercicio: this.vistaEjercicio(ej), mensajes: this.vistaMensajes(s, [tutor]),
    };
  }

  private vencido() {
    return new HttpException(
      { code: 'EJERCICIO_VENCIDO', message: 'Este ejercicio venció porque pasó mucho tiempo. Pide uno nuevo.' },
      HttpStatus.GONE,
    );
  }

  /** Muestra la solución de un ejercicio, solo después de haberlo intentado. */
  async solucion(u: Usuario, id: string, ejId: string) {
    const s = await this.sesion(u, id);
    const ej = s.ejercicios.find((e) => e.id === ejId);
    if (!ej) throw new NotFoundException('Ejercicio no encontrado.');
    if (ej.respuesta === undefined) throw new BadRequestException('Intenta responderlo primero; la solución se muestra después.');
    if (!ej.revelado) {
      ej.revelado = true;
      await this.guardar(s, [this.msg('evento', 'Se le mostró la solución del ejercicio al estudiante.', ej.id)], { ejercicios: s.ejercicios });
    }
    return { ejercicio: this.vistaEjercicio(ej) };
  }

  // ── Retroalimentación al terminar una fase o un test ─────────────────────

  async retroalimentacion(u: Usuario, intentoIds: string[]) {
    const ids = [...new Set(intentoIds)];
    if (!ids.length) throw new BadRequestException('Faltan las respuestas.');
    const clave = `${u.uid}:${[...ids].sort().join(',')}`;
    const guardada = await this.retros.findOne({ _id: clave });
    if (guardada) return guardada['respuesta'];

    const intentos = await this.intentosDelAlumno(u.uid, ids);
    const nodoId = intentos.find((i) => i.nodo_id)?.nodo_id ?? null;
    const mundoId = intentos.find((i) => i.mundo_id)?.mundo_id ?? null;
    const [nodo, mundo, perfil] = await Promise.all([
      nodoId ? this.pg.queryOne<{ titulo: string; guia: string | null }>('SELECT titulo, guia FROM niv_banco.nodo WHERE id = $1', [nodoId]) : Promise.resolve(null),
      mundoId ? this.pg.queryOne<{ titulo: string }>('SELECT titulo FROM niv_banco.mundo WHERE id = $1', [mundoId]) : Promise.resolve(null),
      this.perfil(u),
    ]);
    let res: any = null;
    try {
      res = await this.ai.post('/niv/retroalimentar', {
        contexto: { mundo: mundo?.titulo, nodo: nodo?.titulo ?? null, guia: nodo?.guia ?? null, nivel: perfil.nivel },
        preguntas: intentos.map((i) => ({
          enunciado: i.enunciado, alternativas: i.alternativas, respuesta: i.respuesta,
          correcta: i.correcta, es_correcto: i.es_correcto, explicacion: i.explicacion,
        })),
      });
    } catch (e: any) {
      this.logger.warn(`Retroalimentación falló: ${e?.message ?? e}`);
    }
    if (!res?.ok) return { ok: false, resumen: null, reforzar: [], items: [] };

    const respuesta = {
      ok: true,
      resumen: res.resumen ?? null,
      reforzar: res.reforzar ?? [],
      items: intentos.map((i, k) => ({ intento_id: i.id, comentario: (res.items ?? [])[k] ?? '' })),
    };
    await this.retros.insertOne({ _id: clave, uid: u.uid, respuesta, created_at: new Date() } as any)
      .catch(() => { /* otra petición la guardó primero */ });
    return respuesta;
  }
}
