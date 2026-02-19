import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as path from 'path';
import { AiModule } from './modules/ai/ai.module';
import { AuthModule } from './auth/auth.module';
// 👇 RUTA CORREGIDA: Subimos un nivel con '..' para encontrar la carpeta 'prisma'
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [path.resolve(process.cwd(), '.env')],
    }),
    PrismaModule, // Ahora sí lo encontrará
    AiModule,
    AuthModule,
  ],
})
export class AppModule {}