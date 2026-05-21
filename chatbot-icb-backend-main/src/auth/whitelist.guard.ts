import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class WhitelistGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const email: string | undefined = request.user?.email ?? request.body?.email;

    if (!email) {
      throw new ForbiddenException('No se proporcionó un correo electrónico.');
    }

    const { data, error } = await this.supabase.db
      .from('whitelist_alumnos')
      .select('id')
      .eq('email', email.toLowerCase())
      .eq('activo', true)
      .limit(1)
      .single();

    if (error || !data) {
      throw new ForbiddenException(
        'Tu correo no está autorizado para acceder a esta plataforma.',
      );
    }

    return true;
  }
}
