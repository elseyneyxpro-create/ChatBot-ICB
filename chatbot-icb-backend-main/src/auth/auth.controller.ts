import {
  Controller, Get, Post, Req, Res,
  UseGuards, VERSION_NEUTRAL, HttpCode, HttpStatus, Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { GoogleAuthGuard } from './google.guard';
import { GoogleLoginGuard } from './google-login.guard';
import { getAllowedDomain } from './allowed-domain';
import { AccesoService } from '../modules/nivelacion/acceso.service';
import type { JwtPayload } from './jwt.strategy';

const COOKIE_NAME = 'accessToken';
const COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 días

@Controller({ path: 'auth', version: VERSION_NEUTRAL })
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly cfg: ConfigService,
    private readonly authService: AuthService,
    private readonly acceso: AccesoService,
  ) {}

  private get frontendUrl(): string {
    return (this.cfg.get<string>('FRONTEND_URL') ?? 'http://localhost:4200').replace(/\/+$/, '');
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.cfg.get('NODE_ENV') === 'production',
      sameSite: 'lax' as const,
      path: '/',
    };
  }

  // ── Sesión activa ──────────────────────────────────────────────────────────

  @Get('profile')
  @UseGuards(AuthGuard('jwt'))
  async getProfile(@Req() req: Request) {
    const u = req.user as JwtPayload;
    return {
      uid: u.sub, email: u.email, name: u.name ?? null, picture: u.picture ?? null,
      // false → el front solo muestra la nivelación
      chatbot_habilitado: await this.acceso.chatbotHabilitado(u.email),
    };
  }

  // ── Login con Google (reemplaza Supabase Auth + Firebase Auth) ─────────────

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleAuth() { /* Passport redirige a Google automáticamente */ }

  @Get('google/callback')
  @UseGuards(GoogleLoginGuard)
  async googleCallback(@Req() req: any, @Res() res: Response) {
    if (!req.user?.email) {
      return res.redirect(`${this.frontendUrl}/login?error=domain_not_allowed`);
    }
    try {
      const { jwt } = await this.authService.loginWithGoogle(req.user);
      res.cookie(COOKIE_NAME, jwt, { ...this.cookieOptions(), maxAge: COOKIE_MAX_AGE_MS });
      return res.redirect(`${this.frontendUrl}/auth/callback`);
    } catch (e: any) {
      const status = e?.status ?? e?.getStatus?.();
      if (status === 403) {
        return res.redirect(`${this.frontendUrl}/login?error=not_authorized`);
      }
      this.logger.error(`Error en callback de Google: ${e?.message ?? e}`);
      return res.redirect(`${this.frontendUrl}/login?error=callback_error`);
    }
  }

  // ── Signout ────────────────────────────────────────────────────────────────

  @Post('signout')
  @HttpCode(HttpStatus.OK)
  signOut(@Res({ passthrough: true }) response: Response) {
    response.clearCookie(COOKIE_NAME, this.cookieOptions());
    return { status: 'success', message: 'Sesión cerrada exitosamente.' };
  }

  // ── Diagnóstico ────────────────────────────────────────────────────────────

  @Get('_diag')
  diag() {
    return {
      google: {
        id:            !!this.cfg.get('GOOGLE_CLIENT_ID'),
        secret:        !!this.cfg.get('GOOGLE_CLIENT_SECRET'),
        callback:      this.cfg.get('GOOGLE_CALLBACK_URL'),
        allowedDomain: getAllowedDomain(this.cfg),
      },
      jwt: {
        secret:  !!this.cfg.get('JWT_SECRET'),
        expires: this.cfg.get('JWT_EXPIRES'),
      },
      frontendUrl: this.frontendUrl,
    };
  }
}
