import { Body, Controller, Get, HttpCode, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from './users.service';

@Controller({ path: 'users', version: '1' })
@UseGuards(AuthGuard('jwt'))
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** Devuelve el perfil del usuario autenticado desde Supabase. */
  @Get('me')
  async getMe(@Req() req: any) {
    return this.users.findById(req.user.uid ?? req.user.sub);
  }

  /** Upsertea el perfil del usuario (llamado al login desde el frontend). */
  @Put('me')
  @HttpCode(200)
  async updateMe(@Req() req: any, @Body() body: { nombre?: string; seccion?: string }) {
    const user = req.user;
    return this.users.upsert({
      id_user: user.uid ?? user.sub,
      correo: user.email,
      nombre: body.nombre,
      seccion: body.seccion,
    });
  }
}
