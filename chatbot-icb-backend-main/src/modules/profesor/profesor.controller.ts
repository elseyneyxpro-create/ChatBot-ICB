import { BadRequestException, Controller, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { AiService } from '../ai/ai.service';
import { StaffGuard } from './staff.guard';

/**
 * Panel de profesores: reportes de la nivelación.
 * El cálculo y el Excel los hace el servicio Python (/reportes/...); aquí solo se valida
 * el rol y se decide qué secciones puede ver cada profesor.
 */
@Controller({ path: 'profesor', version: '1' })
@UseGuards(AuthGuard('jwt'), StaffGuard)
export class ProfesorController {
  constructor(private readonly ai: AiService) {}

  /**
   * Secciones que se le piden al servicio Python (undefined = todas).
   *
   * Hoy todo el staff ve todas las secciones. Cuando cada profesor tenga sus secciones
   * asignadas, basta con buscarlas aquí (por ejemplo en una tabla profesor_seccion por correo),
   * devolver solo la intersección con la `seccion` pedida y rechazar las que no le correspondan.
   */
  private secciones(_req: any, seccion?: string): string | undefined {
    if (seccion === undefined || seccion === '') return undefined;
    if (seccion.length > 80 || seccion.includes(',')) throw new BadRequestException('Sección inválida.');
    return seccion;
  }

  /** Todo el reporte (resumen, por sección, por mundo, por nodo, preguntas y alumnos). */
  @Get('nivelacion')
  nivelacion(@Req() req: any, @Query('seccion') seccion?: string) {
    return this.ai.get('/reportes/nivelacion', { secciones: this.secciones(req, seccion) });
  }

  /** El mismo reporte como Excel. */
  @Get('nivelacion/excel')
  async excel(@Req() req: any, @Res() res: Response, @Query('seccion') seccion?: string) {
    const archivo = await this.ai.getArchivo('/reportes/nivelacion/excel', { secciones: this.secciones(req, seccion) });
    res.setHeader('Content-Type', archivo.contentType);
    res.setHeader('Content-Disposition', archivo.disposition ?? 'attachment; filename="reporte_nivelacion.xlsx"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(archivo.data);
  }

  /** Ficha de un alumno: últimas respuestas e historial del agente analista. */
  @Get('nivelacion/alumnos/:uid')
  alumno(@Req() req: any, @Param('uid') uid: string, @Query('seccion') seccion?: string) {
    if (!/^[\w-]{1,64}$/.test(uid)) throw new BadRequestException('Alumno inválido.');
    return this.ai.get(`/reportes/nivelacion/alumno/${encodeURIComponent(uid)}`, {
      secciones: this.secciones(req, seccion),
    });
  }
}
