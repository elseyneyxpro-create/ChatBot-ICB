// 1. Importamos UseGuards y AuthGuard
import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AiService } from './ai.service';
import { AskDto } from './dto/ask.dto';

@Controller({ path: 'ai', version: '1' })
export class AiController {
  constructor(private readonly ai: AiService) {}

  // Proxy principal: POST /v1/ai/answer
  @Post('answer')
  @UseGuards(AuthGuard('jwt')) // 2. ¡Aquí está el guardia!
  @HttpCode(200)
  async answer(@Body() dto: AskDto) {
    // Gracias al guardia, este código solo se ejecutará si el usuario
    // ha enviado una cookie con un JWT válido.
    return this.ai.askPython(dto);
  }

  // El endpoint de Health sigue siendo público, lo cual es correcto.
  @Get('health')
  ping() {
    return {
      ok: true,
      service: 'bff-icb-chatbot',
      ts: new Date().toISOString(),
    };
  }
}