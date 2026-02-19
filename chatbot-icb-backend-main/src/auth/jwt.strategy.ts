// src/auth/jwt.strategy.ts
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express'; // 1. Importamos el tipo Request de Express

export type JwtPayload = {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
  roles?: string[];
  iat?: number;
  exp?: number;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly cfg: ConfigService) {
    const secret = cfg.get<string>('JWT_SECRET');
    if (!secret) {
      throw new InternalServerErrorException(
        'JWT_SECRET no está definido en el .env',
      );
    }

    super({
      // 2. CAMBIO CLAVE: Le decimos a Passport que extraiga el token desde la cookie
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) => {
          return request?.cookies?.accessToken;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload) {
    // Esta lógica no cambia. Si el token es válido, se devuelve el payload.
    return payload; // -> queda en req.user
  }
}