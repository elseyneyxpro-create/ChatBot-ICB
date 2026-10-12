import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PostgresService } from '../database/postgres.service';

@Injectable()
export class WhitelistGuard implements CanActivate {
  constructor(private readonly pg: PostgresService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const email: string | undefined = request.user?.email ?? request.body?.email;

    if (!email) {
      throw new ForbiddenException('No se proporcionó un correo electrónico.');
    }

    const row = await this.pg.queryOne(
      'SELECT id FROM whitelist_alumnos WHERE lower(email) = $1 AND activo = true LIMIT 1',
      [email.toLowerCase()],
    );

    if (!row) {
      throw new ForbiddenException(
        'Tu correo no está autorizado para acceder a esta plataforma.',
      );
    }

    return true;
  }
}
