import { BadRequestException, Controller, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { AiService } from '../ai/ai.service';
import { StaffGuard } from './staff.guard';

/**
 * Panel de profesores: reportes de la nivelación.
 * El cálculo y el Excel los hace el servicio Python (/reportes/...); aquí solo se valida
 * el rol y se decide qué carreras puede ver cada profesor.
 */
@Controller({ path: 'profesor', version: '1' })
@UseGuards(AuthGuard('jwt'), StaffGuard)
export class ProfesorController {
  constructor(private readonly ai: AiService) {}

  /**
   * Carreras que se le piden al servicio Python (undefined = todas).
   * Durante la nivelación los alumnos aún no tienen sección, así que se agrupan por carrera
   * (whitelist_alumnos.carrera).
   *
   * Hoy todo el staff ve todas las carreras. Si más adelante cada profesor debe ver solo
   * algunas, basta con buscarlas aquí (por ejemplo en una tabla por correo del profesor),
   * devolver la intersección con la `carrera` pedida y rechazar las que no le correspondan.
   */
  private carreras(_req: any, carrera?: string): string | undefined {
    if (carrera === undefined || carrera === '') return undefined;
    if (carrera.length > 120 || carrera.includes(',')) throw new BadRequestException('Carrera inválida.');
    return carrera;
  }

  /** Todo el reporte (resumen, por carrera, por mundo, por nodo, preguntas y alumnos). */
  @Get('nivelacion')
  nivelacion(@Req() req: any, @Query('carrera') carrera?: string) {
    return this.ai.get('/reportes/nivelacion', { carreras: this.carreras(req, carrera) });
  }

  /** El mismo reporte como Excel. */
  @Get('nivelacion/excel')
  async excel(@Req() req: any, @Res() res: Response, @Query('carrera') carrera?: string) {
    const archivo = await this.ai.getArchivo('/reportes/nivelacion/excel', { carreras: this.carreras(req, carrera) });
    res.setHeader('Content-Type', archivo.contentType);
    res.setHeader('Content-Disposition', archivo.disposition ?? 'attachment; filename="reporte_nivelacion.xlsx"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(archivo.data);
  }

  /** Ficha de un alumno: últimas respuestas e historial del agente analista. */
  @Get('nivelacion/alumnos/:uid')
  alumno(@Req() req: any, @Param('uid') uid: string, @Query('carrera') carrera?: string) {
    if (!/^[\w-]{1,64}$/.test(uid)) throw new BadRequestException('Alumno inválido.');
    return this.ai.get(`/reportes/nivelacion/alumno/${encodeURIComponent(uid)}`, {
      carreras: this.carreras(req, carrera),
    });
  }
}
