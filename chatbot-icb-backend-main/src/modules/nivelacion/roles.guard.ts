import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AccesoService } from './acceso.service';

/**
 * La nivelación (y su tutor) es para alumnos. Los profesores (staff) usan el panel docente y el chat.
 * El equipo de desarrollo (dev) sí entra, para probar. Va DESPUÉS de AuthGuard('jwt').
 */
@Injectable()
export class SoloAlumnosGuard implements CanActivate {
  constructor(private readonly acceso: AccesoService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    if ((await this.acceso.rol(req.user?.email)) !== 'staff') return true;
    throw new ForbiddenException({
      code: 'SOLO_ALUMNOS',
      message: 'La nivelación es para alumnos. Como profesor tienes el panel docente y el chat.',
    });
  }
}

/** Herramientas de demo/desarrollo: solo whitelist_alumnos.codigo_asignatura = crack. */
@Injectable()
export class DevGuard implements CanActivate {
  constructor(private readonly acceso: AccesoService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    if ((await this.acceso.rol(req.user?.email)) === 'dev') return true;
    throw new ForbiddenException({ code: 'SOLO_DEV', message: 'Solo para el equipo de desarrollo.' });
  }
}
