import { Body, Controller, Get, HttpCode, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsOptional, IsString } from 'class-validator';
import { UsersService } from './users.service';

class UpdateMeDto {
  @IsString()
  @IsOptional()
  nombre?: string;
}

@Controller({ path: 'users', version: '1' })
@UseGuards(AuthGuard('jwt'))
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** Devuelve el perfil del usuario autenticado desde Postgres. */
  @Get('me')
  async getMe(@Req() req: any) {
    return this.users.findById(req.user.sub);
  }

  /** Actualiza el nombre del usuario autenticado. */
  @Put('me')
  @HttpCode(200)
  async updateMe(@Req() req: any, @Body() body: UpdateMeDto) {
    return this.users.upsert({
      id_user: req.user.sub,
      correo: req.user.email,
      nombre: body.nombre,
    });
  }
}
