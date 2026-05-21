import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';

export interface UpsertUserDto {
  id_user: string;   // firebase uid
  correo: string;
  nombre?: string;
  seccion?: string;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async upsert(dto: UpsertUserDto) {
    const { data, error } = await this.supabase.db
      .from('usuarios')
      .upsert(
        {
          id_user: dto.id_user,
          correo: dto.correo.toLowerCase(),
          nombre: dto.nombre ?? null,
          seccion: dto.seccion ?? null,
        },
        { onConflict: 'id_user' },
      )
      .select()
      .single();

    if (error) {
      this.logger.warn(`upsert usuario falló: ${error.message}`);
      throw error;
    }
    return data;
  }

  async findById(id_user: string) {
    const { data } = await this.supabase.db
      .from('usuarios')
      .select('*')
      .eq('id_user', id_user)
      .single();
    return data ?? null;
  }

  async findByEmail(correo: string) {
    const { data } = await this.supabase.db
      .from('usuarios')
      .select('*')
      .eq('correo', correo.toLowerCase())
      .single();
    return data ?? null;
  }
}
