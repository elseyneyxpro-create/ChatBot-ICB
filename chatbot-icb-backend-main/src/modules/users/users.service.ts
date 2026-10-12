import { Injectable } from '@nestjs/common';
import { PostgresService } from '../../database/postgres.service';

export interface UpsertUserDto {
  id_user: string;
  correo: string;
  nombre?: string;
}

/**
 * Perfil del usuario en la tabla `usuario` de Postgres (antes en Supabase).
 * Nota: el código antiguo usaba la tabla `usuarios` (plural) acá y `usuario` en auth;
 * la que existe en la base es `usuario`, así que se unificó.
 */
@Injectable()
export class UsersService {
  constructor(private readonly pg: PostgresService) {}

  async upsert(dto: UpsertUserDto) {
    return this.pg.queryOne(
      `INSERT INTO usuario (id_user, correo, nombre)
       VALUES ($1, $2, $3)
       ON CONFLICT (id_user) DO UPDATE SET correo = EXCLUDED.correo,
                                           nombre = COALESCE(EXCLUDED.nombre, usuario.nombre)
       RETURNING *`,
      [dto.id_user, dto.correo.toLowerCase(), dto.nombre ?? null],
    );
  }

  async findById(id_user: string) {
    return this.pg.queryOne('SELECT * FROM usuario WHERE id_user = $1', [id_user]);
  }

  async findByEmail(correo: string) {
    return this.pg.queryOne('SELECT * FROM usuario WHERE lower(correo) = $1', [correo.toLowerCase()]);
  }
}
