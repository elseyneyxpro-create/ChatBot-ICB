import { Injectable } from '@nestjs/common';
import { PostgresService } from '../../database/postgres.service';

/**
 * Valores de whitelist_alumnos.codigo_asignatura que identifican al equipo.
 * Los alumnos llevan ahí su sección (ej. CBM1101_VC03). Se comparan sin mayúsculas/minúsculas.
 *   - staff → profesores: panel docente y chat, SIN nivelación
 *   - crack → equipo de desarrollo: todo, más el selector de vista para demos
 */
export const CODIGOS_PROFESOR = ['staff'];
export const CODIGOS_DEV = ['crack'];
export const CODIGOS_STAFF = [...CODIGOS_PROFESOR, ...CODIGOS_DEV];

/** dev = equipo de desarrollo · staff = profesor · alumno */
export type Rol = 'dev' | 'staff' | 'alumno';

/**
 * Decide si un alumno puede usar el chatbot o solo la nivelación.
 * Fuente: columna whitelist_alumnos.chatbot_habilitado
 *   - alumnos antiguos → true
 *   - alumnos nuevos   → false hasta completar la nivelación (o que lo cambien a mano en la BD)
 */
@Injectable()
export class AccesoService {
  constructor(private readonly pg: PostgresService) {}

  /** Profesores y equipo siempre tienen el chat; los alumnos, según la columna chatbot_habilitado. */
  async chatbotHabilitado(correo: string | undefined | null): Promise<boolean> {
    if (!correo) return false;
    const row = await this.pg.queryOne<{ habilitado: boolean }>(
      `SELECT bool_or(chatbot_habilitado OR lower(trim(coalesce(codigo_asignatura, ''))) = ANY($2)) AS habilitado
         FROM whitelist_alumnos
        WHERE lower(email) = $1 AND activo = true`,
      [correo.toLowerCase(), CODIGOS_STAFF],
    );
    return row?.habilitado === true;
  }

  /** Rol según las filas activas de la whitelist con ese correo (dev gana a staff). */
  async rol(correo: string | undefined | null): Promise<Rol> {
    if (!correo) return 'alumno';
    const row = await this.pg.queryOne<{ dev: boolean; staff: boolean }>(
      `SELECT bool_or(lower(trim(coalesce(codigo_asignatura, ''))) = ANY($2)) AS dev,
              bool_or(lower(trim(coalesce(codigo_asignatura, ''))) = ANY($3)) AS staff
         FROM whitelist_alumnos
        WHERE lower(email) = $1 AND activo = true`,
      [correo.toLowerCase(), CODIGOS_DEV, CODIGOS_PROFESOR],
    );
    return row?.dev ? 'dev' : row?.staff ? 'staff' : 'alumno';
  }

  /** Se llama cuando el alumno completa todos los mundos de la nivelación. */
  async habilitarChatbot(correo: string): Promise<boolean> {
    const rows = await this.pg.query(
      `UPDATE whitelist_alumnos SET chatbot_habilitado = true
        WHERE lower(email) = $1 AND chatbot_habilitado = false
        RETURNING 1`,
      [correo.toLowerCase()],
    );
    return rows.length > 0;
  }
}
