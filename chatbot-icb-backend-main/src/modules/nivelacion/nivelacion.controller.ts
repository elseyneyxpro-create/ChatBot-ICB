import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { NivelacionService } from './nivelacion.service';
import { RespuestaEntrenarDto, RespuestasDto } from './nivelacion.dto';

const usuario = (req: any) => ({ uid: req.user.sub as string, email: req.user.email as string });

/** Nivelación: abierta para todos los alumnos logueados (no requiere chatbot habilitado). */
@Controller({ path: 'nivelacion', version: '1' })
@UseGuards(AuthGuard('jwt'))
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

  /** Modo Entrenar: genera una pregunta nueva con IA (no se guarda en el banco). */
  @Post('nodos/:id/entrenar')
  @HttpCode(200)
  generar(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.niv.generarPregunta(usuario(req), id);
  }

  @Post('entrenar/:id')
  @HttpCode(200)
  responderGenerada(@Req() req: any, @Param('id') id: string, @Body() dto: RespuestaEntrenarDto) {
    return this.niv.responderGenerada(usuario(req), id, dto.respuesta);
  }

  @Get('analisis')
  analisis(@Req() req: any) {
    return this.niv.ultimoAnalisis(req.user.sub);
  }
}
