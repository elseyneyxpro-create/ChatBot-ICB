import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ProfesorController } from './profesor.controller';
import { StaffGuard } from './staff.guard';

/** Panel de profesores (staff). AccesoService viene del NivelacionModule, que es global. */
@Module({
  imports: [AiModule],
  controllers: [ProfesorController],
  providers: [StaffGuard],
})
export class ProfesorModule {}
