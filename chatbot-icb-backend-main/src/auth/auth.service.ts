import { Injectable, ForbiddenException, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { FirebaseAdminService } from '../firebase-admin/firebase-admin.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly allowedDomain: string;

  constructor(
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
    private readonly supabase: SupabaseService,
    private readonly firebaseAdmin: FirebaseAdminService,
  ) {
    this.allowedDomain = this.cfg.get<string>('ALLOWED_DOMAIN') ?? 'mail.udp.cl';
  }

  /**
   * Intercambia un Supabase access_token por:
   *  - Una cookie JWT propia de NestJS (se setea en el controller)
   *  - Un Firebase custom token para acceder a Firestore
   *
   * Capas de seguridad:
   *  1. Supabase verifica la firma del token (Google OAuth via Supabase)
   *  2. Dominio @mail.udp.cl obligatorio
   *  3. Whitelist de alumnos activos en Supabase
   */
  async exchangeSupabaseToken(supabaseToken: string): Promise<{
    nestJwt: string;
    firebaseCustomToken: string;
    user: { uid: string; email: string; nombre?: string; photoURL?: string };
  }> {
    // 1. Verificar token con Supabase
    const { data: { user: sbUser }, error } = await this.supabase.db.auth.getUser(supabaseToken);
    if (error || !sbUser) {
      throw new UnauthorizedException('Token de Supabase inválido o expirado.');
    }

    const email = sbUser.email ?? '';

    // 2. Verificar dominio
    if (!email.endsWith(`@${this.allowedDomain}`)) {
      throw new ForbiddenException(`Solo se permiten correos @${this.allowedDomain}`);
    }

    // 3. Verificar whitelist
    const { data: wl } = await this.supabase.db
      .from('whitelist_alumnos')
      .select('id')
      .eq('email', email.toLowerCase())
      .eq('activo', true)
      .limit(1)
      .single();

    if (!wl) {
      throw new ForbiddenException('Tu correo no está autorizado para acceder a esta plataforma.');
    }

    // 4. Upsert en tabla usuario (nombre en singular, así está en Supabase)
    const nombre    = sbUser.user_metadata?.['full_name'] ?? sbUser.user_metadata?.['name'] ?? null;
    const photoURL  = sbUser.user_metadata?.['avatar_url'] ?? sbUser.user_metadata?.['picture'] ?? null;
    await this.supabase.db
      .from('usuario')
      .upsert(
        { id_user: sbUser.id, correo: email.toLowerCase(), nombre },
        { onConflict: 'id_user' },
      );

    // 5. Emitir JWT propio de NestJS
    const nestJwt = await this.jwt.signAsync({
      sub: sbUser.id,
      email,
      name: nombre,
    });

    // 6. Emitir Firebase custom token (mismo uid → mismos docs en Firestore)
    const firebaseCustomToken = await this.firebaseAdmin.auth.createCustomToken(sbUser.id);

    return { nestJwt, firebaseCustomToken, user: { uid: sbUser.id, email, nombre, photoURL } };
  }
}
