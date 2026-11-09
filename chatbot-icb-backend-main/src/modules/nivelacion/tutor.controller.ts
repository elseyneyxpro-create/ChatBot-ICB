import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RespuestaEntrenarDto } from './nivelacion.dto';
import { CrearSesionDto, MensajeTutorDto, RetroalimentacionDto } from './tutor.dto';
import { TutorService } from './tutor.service';
import { SoloAlumnosGuard } from './roles.guard';

const usuario = (req: any) => ({ uid: req.user.sub as string, email: req.user.email as string });

/**
 * "Aprende con el tutor" y retroalimentación de fases/tests.
 * Abierto a todos los alumnos logueados, igual que la nivelación (no requiere chatbot habilitado).
 */
@Controller({ path: 'nivelacion', version: '1' })
@UseGuards(AuthGuard('jwt'), SoloAlumnosGuard)
export class TutorController {
  constructor(private readonly tutor: TutorService) {}

  /** Comentario de la IA por pregunta + qué reforzar, al terminar una fase o un test. */
  @Post('retroalimentacion')
  @HttpCode(200)
  retroalimentacion(@Req() req: any, @Body() dto: RetroalimentacionDto) {
    return this.tutor.retroalimentacion(usuario(req), dto.intento_ids);
  }

  /** Abre (o retoma) una conversación con el tutor sobre un nodo, o para revisar respuestas. */
  @Post('tutor/sesiones')
  @HttpCode(200)
  crear(@Req() req: any, @Body() dto: CrearSesionDto) {
    return this.tutor.crear(usuario(req), dto);
  }

  @Get('tutor/sesiones/:id')
  obtener(@Req() req: any, @Param('id') id: string) {
    return this.tutor.obtener(usuario(req), id);
  }

  @Post('tutor/sesiones/:id/mensajes')
  @HttpCode(200)
  mensaje(@Req() req: any, @Param('id') id: string, @Body() dto: MensajeTutorDto) {
    return this.tutor.mensaje(usuario(req), id, dto.texto, dto.propio === true);
  }

  @Post('tutor/sesiones/:id/ejercicio')
  @HttpCode(200)
  ejercicio(@Req() req: any, @Param('id') id: string) {
    return this.tutor.ejercicio(usuario(req), id);
  }

  @Post('tutor/sesiones/:id/ejercicio/:ej/respuesta')
  @HttpCode(200)
  responder(@Req() req: any, @Param('id') id: string, @Param('ej') ej: string, @Body() dto: RespuestaEntrenarDto) {
    return this.tutor.responderEjercicio(usuario(req), id, ej, dto.respuesta);
  }

  @Post('tutor/sesiones/:id/ejercicio/:ej/solucion')
  @HttpCode(200)
  solucion(@Req() req: any, @Param('id') id: string, @Param('ej') ej: string) {
    return this.tutor.solucion(usuario(req), id, ej);
  }
}
