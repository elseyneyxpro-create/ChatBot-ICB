import { Injectable } from '@nestjs/common';
import { PostgresService } from '../../database/postgres.service';

/**
 * Valores de whitelist_alumnos.codigo_asignatura que identifican al equipo (profesores y desarrolladores).
 * Los alumnos llevan ahí su sección (ej. CBM1101_VC03). Se comparan sin mayúsculas/minúsculas.
 */
export const CODIGOS_STAFF = ['staff', 'crack'];

export type Rol = 'staff' | 'alumno';

/**
 * Decide si un alumno puede usar el chatbot o solo la nivelación.
 * Fuente: columna whitelist_alumnos.chatbot_habilitado
 *   - alumnos antiguos → true
 *   - alumnos nuevos   → false hasta completar la nivelación (o que lo cambien a mano en la BD)
 */
@Injectable()
export class AccesoService {
  constructor(private readonly pg: PostgresService) {}

  async chatbotHabilitado(correo: string | undefined | null): Promise<boolean> {
    if (!correo) return false;
    const row = await this.pg.queryOne<{ chatbot_habilitado: boolean }>(
      `SELECT chatbot_habilitado FROM whitelist_alumnos
        WHERE lower(email) = $1 AND activo = true
        ORDER BY chatbot_habilitado DESC LIMIT 1`,
      [correo.toLowerCase()],
    );
    return row?.chatbot_habilitado === true;
  }

  /** 'staff' si alguna fila activa de la whitelist con ese correo tiene un código de staff. */
  async rol(correo: string | undefined | null): Promise<Rol> {
    if (!correo) return 'alumno';
    const row = await this.pg.queryOne<{ staff: boolean }>(
      `SELECT bool_or(lower(trim(coalesce(codigo_asignatura, ''))) = ANY($2)) AS staff
         FROM whitelist_alumnos
        WHERE lower(email) = $1 AND activo = true`,
      [correo.toLowerCase(), CODIGOS_STAFF],
    );
    return row?.staff ? 'staff' : 'alumno';
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
