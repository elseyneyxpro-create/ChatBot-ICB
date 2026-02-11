import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { AiService } from './ai.service';
import { AskDto } from './dto/ask.dto';

@Controller({ path: 'ai', version: '1' })
export class AiController {
  constructor(private readonly ai: AiService) {}

  // Proxy principal: POST /v1/ai/answer
  @Post('answer')
  @HttpCode(200)
  async answer(@Body() dto: AskDto) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return this.ai.askPython(dto);
  }

  // Health del BFF (y útil para monitorizar)
  @Get('health')
  ping() {
    return {
      ok: true,
      service: 'bff-icb-chatbot',
      ts: new Date().toISOString(),
    };
  }
}
