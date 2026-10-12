import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ChatbotHabilitadoGuard } from '../nivelacion/chatbot-habilitado.guard';
import { AiService } from './ai.service';
import { AskDto } from './dto/ask.dto';
import { EvaluateConceptoDto } from './dto/evaluate-concepto.dto';
import { EvaluateVofDto } from './dto/evaluate-vof.dto';
import { EvaluateErrorDto } from './dto/evaluate-error.dto';
import { SaveExerciseResultDto } from './dto/save-exercise-result.dto';
import { ChatsService } from '../chats/chats.service';

/**
 * Proxy al servicio Python.
 * El uid SIEMPRE se toma del JWT (antes lo mandaba el frontend en el body y se podía falsificar),
 * y si viene id_chat_nr se verifica que el chat sea del usuario.
 */
@Controller({ path: 'ai', version: '1' })
@UseGuards(AuthGuard('jwt'), ChatbotHabilitadoGuard)
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly chats: ChatsService,
  ) {}

  private async withUser<T extends { uid?: string; id_chat_nr?: string }>(req: any, dto: T): Promise<T> {
    const uid: string = req.user.sub;
    if (dto.id_chat_nr) await this.chats.assertOwner(dto.id_chat_nr, uid);
    return { ...dto, uid };
  }

  @Get('health')
  ping() {
    return { ok: true, service: 'bff-icb-chatbot', ts: new Date().toISOString() };
  }

  @Post('answer')
  @HttpCode(200)
  async answer(@Req() req: any, @Body() dto: AskDto) {
    return this.ai.askPython(await this.withUser(req, dto));
  }

  @Get('videos')
  async videos() {
    return this.ai.getVideos();
  }

  @Post('evaluate-concepto')
  @HttpCode(200)
  async evaluateConcepto(@Req() req: any, @Body() dto: EvaluateConceptoDto) {
    return this.ai.evaluateConcepto(await this.withUser(req, dto));
  }

  @Post('evaluate-vof')
  @HttpCode(200)
  async evaluateVof(@Req() req: any, @Body() dto: EvaluateVofDto) {
    return this.ai.evaluateVof(await this.withUser(req, dto));
  }

  @Post('evaluate-error')
  @HttpCode(200)
  async evaluateError(@Req() req: any, @Body() dto: EvaluateErrorDto) {
    return this.ai.evaluateError(await this.withUser(req, dto));
  }

  @Post('save-exercise-result')
  @HttpCode(200)
  async saveExerciseResult(@Req() req: any, @Body() dto: SaveExerciseResultDto) {
    return this.ai.saveExerciseResult(await this.withUser(req, dto));
  }
}
