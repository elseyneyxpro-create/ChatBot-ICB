import { Injectable, UnauthorizedException } from '@nestjs/common';
import { getAllowedDomain } from './allowed-domain';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private readonly cfg: ConfigService) {
    const clientID     = cfg.get<string>('GOOGLE_CLIENT_ID')     || 'DISABLED';
    const clientSecret = cfg.get<string>('GOOGLE_CLIENT_SECRET') || 'DISABLED';
    const callbackURL  = cfg.get<string>('GOOGLE_CALLBACK_URL')  || 'http://localhost/auth/google/callback';

    super({
      clientID,
      clientSecret,
      callbackURL,
      scope: ['profile', 'email'],
      state: false,
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
      const allowed = getAllowedDomain(this.cfg);

      if (!email || !email.toLowerCase().endsWith(`@${allowed}`)) {
        return done(new UnauthorizedException(`Solo se permiten correos @${allowed}`), false);
      }

      return done(null, {
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
