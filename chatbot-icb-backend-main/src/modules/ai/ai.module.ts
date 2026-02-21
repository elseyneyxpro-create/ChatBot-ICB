import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [
    HttpModule.registerAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        // base del servicio python
        baseURL: cfg.get<string>('PYTHON_BASE_URL') ?? process.env.PYTHON_BASE_URL,
        timeout: Number(cfg.get('PYTHON_TIMEOUT_MS') ?? 15000),
        headers: { 'Content-Type': 'application/json' },
      }),
    }),
  ],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
