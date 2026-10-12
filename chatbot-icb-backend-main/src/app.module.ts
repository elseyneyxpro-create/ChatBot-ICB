import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as path from 'path';
import { AiModule } from './modules/ai/ai.module';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { UsersModule } from './modules/users/users.module';
import { ChatsModule } from './modules/chats/chats.module';
import { ProfileModule } from './modules/profile/profile.module';
import { NivelacionModule } from './modules/nivelacion/nivelacion.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [path.resolve(process.cwd(), '.env')],
    }),
    DatabaseModule,
    UsersModule,
    ChatsModule,
    ProfileModule,
    NivelacionModule,
    AiModule,
    AuthModule,
  ],
})
export class AppModule {}
