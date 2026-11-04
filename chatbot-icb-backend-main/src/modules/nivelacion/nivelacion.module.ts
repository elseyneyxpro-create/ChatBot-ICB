import { Global, Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { NivelacionController } from './nivelacion.controller';
import { NivelacionService } from './nivelacion.service';
import { AccesoService } from './acceso.service';
import { ChatbotHabilitadoGuard } from './chatbot-habilitado.guard';
import { TutorController } from './tutor.controller';
import { TutorService } from './tutor.service';

/** Global para que AccesoService/ChatbotHabilitadoGuard se usen en los módulos del chatbot. */
@Global()
@Module({
  imports: [AiModule],
  controllers: [NivelacionController, TutorController],
  providers: [NivelacionService, AccesoService, ChatbotHabilitadoGuard, TutorService],
  exports: [AccesoService, ChatbotHabilitadoGuard],
})
export class NivelacionModule {}
