import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AiService } from './ai.service';
import { AskDto } from './dto/ask.dto';
import { EvaluateConceptoDto } from './dto/evaluate-concepto.dto';
import { EvaluateVofDto } from './dto/evaluate-vof.dto';
import { EvaluateErrorDto } from './dto/evaluate-error.dto';
import { SaveExerciseResultDto } from './dto/save-exercise-result.dto';

@Controller({ path: 'ai', version: '1' })
@UseGuards(AuthGuard('jwt'))
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('health')
  ping() {
    return { ok: true, service: 'bff-icb-chatbot', ts: new Date().toISOString() };
  }

  @Post('answer')
  @HttpCode(200)
  async answer(@Body() dto: AskDto) {
    return this.ai.askPython(dto);
  }

  @Get('videos')
  async videos() {
    return this.ai.getVideos();
  }

  @Post('evaluate-concepto')
  @HttpCode(200)
  async evaluateConcepto(@Body() dto: EvaluateConceptoDto) {
    return this.ai.evaluateConcepto(dto);
  }

  @Post('evaluate-vof')
  @HttpCode(200)
  async evaluateVof(@Body() dto: EvaluateVofDto) {
    return this.ai.evaluateVof(dto);
  }

  @Post('evaluate-error')
  @HttpCode(200)
  async evaluateError(@Body() dto: EvaluateErrorDto) {
    return this.ai.evaluateError(dto);
  }

  @Post('save-exercise-result')
  @HttpCode(200)
  async saveExerciseResult(@Body() dto: SaveExerciseResultDto) {
    return this.ai.saveExerciseResult(dto);
  }
}
