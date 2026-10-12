import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PostgresService } from '../database/postgres.service';
import { MongoService } from '../database/mongo.service';
import { getAllowedDomain } from './allowed-domain';
import type { JwtPayload } from './jwt.strategy';

export interface GoogleUser {
  email: string;
  name?: string | null;
  picture?: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly allowedDomain: string;

  constructor(
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
    private readonly pg: PostgresService,
    private readonly mongo: MongoService,
  ) {
    this.allowedDomain = getAllowedDomain(this.cfg);
  }

  /**
   * Completa el login con Google (reemplaza el exchange Supabase → Firebase).
   *
   * Capas de seguridad:
   *  1. Google valida la cuenta (passport-google-oauth20)
   *  2. Dominio @mail.udp.cl obligatorio
   *  3. Whitelist de alumnos activos en Postgres
   *
   * El uid del usuario se conserva: si el correo ya existe en la tabla `usuario`
   * (migrada desde Supabase) se reutiliza su id_user, así sus chats y perfil en Mongo
   * siguen asociados a él.
   */
  async loginWithGoogle(google: GoogleUser): Promise<{ jwt: string; payload: JwtPayload }> {
    const email = (google.email ?? '').toLowerCase();

    if (!email.endsWith(`@${this.allowedDomain}`)) {
      throw new ForbiddenException(`Solo se permiten correos @${this.allowedDomain}`);
    }

    const wl = await this.pg.queryOne(
      'SELECT id FROM whitelist_alumnos WHERE lower(email) = $1 AND activo = true LIMIT 1',
      [email],
    );
    if (!wl) {
      throw new ForbiddenException('Tu correo no está autorizado para acceder a esta plataforma.');
    }

    const nombre = google.name ?? null;
    const picture = google.picture ?? null;

    const existing = await this.pg.queryOne<{ id_user: string }>(
      'SELECT id_user FROM usuario WHERE lower(correo) = $1 LIMIT 1',
      [email],
    );
    const uid = existing?.id_user ?? randomUUID();

    await this.pg.query(
      `INSERT INTO usuario (id_user, correo, nombre)
       VALUES ($1, $2, $3)
       ON CONFLICT (id_user) DO UPDATE SET correo = EXCLUDED.correo,
                                           nombre = COALESCE(EXCLUDED.nombre, usuario.nombre)`,
      [uid, email, nombre],
    );

    // Nombre y foto para el leaderboard (antes lo escribía el frontend en Firestore)
    await this.mongo.col('Perfil_usuario').updateOne(
      { _id: uid },
      {
        $set: {
          profile: { display_name: nombre ?? '', photo_url: picture ?? '' },
          fecha_actualizacion: new Date(),
        },
      },
      { upsert: true },
    ).catch((e) => this.logger.warn(`No se pudo guardar Perfil_usuario: ${e.message}`));

    const payload: JwtPayload = { sub: uid, email, name: nombre ?? undefined, picture: picture ?? undefined, roles: ['user'] };
    const jwt = await this.jwt.signAsync(payload);
    return { jwt, payload };
  }
}
