import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private readonly cfg: ConfigService) {
    const clientID     = cfg.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = cfg.get<string>('GOOGLE_CLIENT_SECRET');
    const callbackURL  = cfg.get<string>('GOOGLE_CALLBACK_URL');

    // Logs de diagnóstico
    // (se verán cuando entres a /auth/google)
    // OJO: no logeamos valores reales, solo si existen.
    // eslint-disable-next-line no-console
    console.log('[GOOGLE_STRATEGY]',
      { clientID: !!clientID, clientSecret: !!clientSecret, callbackURL });

    if (!clientID || !clientSecret || !callbackURL) {
      throw new InternalServerErrorException(
        'Google OAuth mal configurado (clientID/secret/callback). Revisa tu .env y ConfigModule.forRoot().',
      );
    }

    super({
      clientID,
      clientSecret,
      callbackURL,
      scope: ['profile', 'email'],
      state: false,                 // importante: sin sesiones con Fastify
      passReqToCallback: false,
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: any,
    done: (err: any, user?: any) => void,
  ) {
    try {
      const email   = profile?.emails?.[0]?.value;
      const picture = profile?.photos?.[0]?.value;
      const allowed = this.cfg.get<string>('ALLOWED_GOOGLE_DOMAIN');

      if (allowed && email && !email.endsWith(`@${allowed}`)) {
        return done(null, false); // dominio no permitido
      }

      return done(null, {
        sub: profile.id,
        email,
        name: profile.displayName,
        picture,
        roles: ['user'],
      });
    } catch (e) {
      return done(e, false);
    }
  }
}
