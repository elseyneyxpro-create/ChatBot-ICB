import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { NivelacionService } from './nivelacion.service';
import { ModoDevDto, RespuestasDto } from './nivelacion.dto';
import { DevGuard, SoloAlumnosGuard } from './roles.guard';

const usuario = (req: any) => ({ uid: req.user.sub as string, email: req.user.email as string });

/**
 * Nivelación: abierta para todos los alumnos logueados (no requiere chatbot habilitado).
 * Los profesores (staff) no entran: tienen el panel docente y el chat.
 */
@Controller({ path: 'nivelacion', version: '1' })
@UseGuards(AuthGuard('jwt'), SoloAlumnosGuard)
export class NivelacionController {
  constructor(private readonly niv: NivelacionService) {}

  /** Nivel, XP, mundos con su avance y último análisis del agente. */
  @Get('estado')
  estado(@Req() req: any) {
    return this.niv.estado(usuario(req));
  }

  @Get('mundos/:id')
  mundo(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.niv.mundo(usuario(req), id);
  }

  @Get('nodos/:id/fase')
  preguntasFase(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.niv.preguntasFase(usuario(req), id);
  }

  @Post('nodos/:id/fase')
  @HttpCode(200)
  responderFase(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() dto: RespuestasDto) {
    return this.niv.responderFase(usuario(req), id, dto.respuestas);
  }

  @Get('mundos/:id/test')
  preguntasTest(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.niv.preguntasTest(usuario(req), id);
  }

  @Post('mundos/:id/test')
  @HttpCode(200)
  responderTest(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() dto: RespuestasDto) {
    return this.niv.responderTest(usuario(req), id, dto.respuestas);
  }

  // Los ejercicios generados por IA (antes "modo Entrenar") se piden y responden SOLO a través del
  // tutor (tutor.controller.ts), que aplica el límite diario. No hay rutas directas.

  @Get('analisis')
  analisis(@Req() req: any) {
    return this.niv.ultimoAnalisis(req.user.sub);
  }

  /** Modo dev (equipo, para demos): todos los mundos y nodos desbloqueados para su propia cuenta. */
  @Get('dev')
  @UseGuards(DevGuard)
  async modoDev(@Req() req: any) {
    return { desbloquear: await this.niv.devDesbloqueo(req.user.sub) };
  }

  @Put('dev')
  @UseGuards(DevGuard)
  cambiarModoDev(@Req() req: any, @Body() dto: ModoDevDto) {
    return this.niv.cambiarDevDesbloqueo(req.user.sub, dto.desbloquear);
  }
}
