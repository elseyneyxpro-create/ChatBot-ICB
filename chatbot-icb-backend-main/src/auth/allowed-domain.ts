import { ConfigService } from '@nestjs/config';

/** Dominio de correo permitido para iniciar sesión (por defecto mail.udp.cl). */
export function getAllowedDomain(cfg: ConfigService): string {
  return cfg.get<string>('ALLOWED_DOMAIN') ?? cfg.get<string>('ALLOWED_GOOGLE_DOMAIN') ?? 'mail.udp.cl';
}
