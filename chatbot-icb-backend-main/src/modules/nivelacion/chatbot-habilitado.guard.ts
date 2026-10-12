import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AccesoService } from './acceso.service';

/**
 * Bloquea las rutas del chatbot normal a quien todavía no lo tiene habilitado.
 * Va DESPUÉS de AuthGuard('jwt'), porque usa req.user.
 */
@Injectable()
export class ChatbotHabilitadoGuard implements CanActivate {
  constructor(private readonly acceso: AccesoService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    if (await this.acceso.chatbotHabilitado(req.user?.email)) return true;
    throw new ForbiddenException({
      code: 'NIVELACION_PENDIENTE',
      message: 'Primero debes completar la nivelación para usar el chatbot.',
    });
  }
}
