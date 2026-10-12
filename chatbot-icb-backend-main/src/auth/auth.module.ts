import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AuthController } from './auth.controller';
import { GoogleStrategy } from './google.strategy';
import { JwtStrategy } from './jwt.strategy';
import { AuthService } from './auth.service';
import { WhitelistGuard } from './whitelist.guard';

@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ session: false }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        global: true,
        secret: cfg.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: parseExpires(cfg.get<string>('JWT_EXPIRES') || '7d') as any },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, GoogleStrategy, JwtStrategy, WhitelistGuard],
})
export class AuthModule {}

function parseExpires(exp: string): number {
  const n = Number(exp);
  if (Number.isFinite(n)) return n;
  const m = exp.match(/^(\d+)\s*([smhdwy])$/i);
  if (!m) return 3600;
  const value = parseInt(m[1], 10);
  const mult: Record<string, number> = { s:1, m:60, h:3600, d:86400, w:604800, y:31536000 };
  return value * (mult[m[2].toLowerCase()] ?? 3600);
}