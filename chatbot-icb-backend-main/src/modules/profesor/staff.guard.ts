import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AccesoService } from '../nivelacion/acceso.service';

/**
 * Solo deja pasar a profesores (staff) y al equipo (crack): whitelist_alumnos.codigo_asignatura.
 * Se consulta la base en cada request (no el JWT), así un cambio de rol aplica de inmediato.
 * Va DESPUÉS de AuthGuard('jwt'), porque usa req.user.
 */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(private readonly acceso: AccesoService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    if ((await this.acceso.rol(req.user?.email)) !== 'alumno') return true;
    throw new ForbiddenException({ code: 'SOLO_STAFF', message: 'Esta sección es solo para profesores.' });
  }
}
