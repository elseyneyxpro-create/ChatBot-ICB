import {
  Controller, Get, Post, Headers, Req, Res,
  UseGuards, VERSION_NEUTRAL, HttpCode, HttpStatus, UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { GoogleAuthGuard } from './google.guard';
import { GoogleLoginGuard } from './google-login.guard';

@Controller({ path: 'auth', version: VERSION_NEUTRAL })
export class AuthController {
  constructor(
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
    private readonly authService: AuthService,
  ) {}

  // ── Sesión activa ──────────────────────────────────────────────────────────

  @Get('profile')
  @UseGuards(AuthGuard('jwt'))
  getProfile(@Req() req: Request) {
    return req.user;
  }

  // ── Exchange Supabase → NestJS cookie + Firebase custom token ─────────────

  @Post('exchange')
  @HttpCode(HttpStatus.OK)
  async exchange(
    @Headers('authorization') authHeader: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
    if (!token) throw new UnauthorizedException('Authorization header requerido.');

    const { nestJwt, firebaseCustomToken, user } =
      await this.authService.exchangeSupabaseToken(token);

    response.cookie('accessToken', nestJwt, {
      httpOnly: true,
      secure: this.cfg.get('NODE_ENV') === 'production',
      sameSite: 'lax',
      expires: new Date(Date.now() + 3600 * 24 * 7 * 1000),
    });

    return { ok: true, firebaseCustomToken, user };
  }

  // ── Signout ────────────────────────────────────────────────────────────────

  @Post('signout')
  @HttpCode(HttpStatus.OK)
  signOut(@Res({ passthrough: true }) response: Response) {
    response.clearCookie('accessToken', {
      httpOnly: true,
      secure: this.cfg.get('NODE_ENV') === 'production',
      sameSite: 'lax',
    });
    return { status: 'success', message: 'Sesión cerrada exitosamente.' };
  }

  // ── Google OAuth legacy (deshabilitado, GOOGLE_CLIENT_ID=DISABLED) ─────────

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleAuth() { /* Passport redirige a Google automáticamente */ }

  @Get('google/callback')
  @UseGuards(GoogleLoginGuard)
  async googleCallback(@Req() req: any, @Res() res: Response) {
    try {
      if (!req.user) {
        return res.redirect('http://localhost:4200/login?error=domain_not_allowed');
      }
      const payload = { sub: req.user.sub, email: req.user.email, name: req.user.name, picture: req.user.picture, roles: ['user'] };
      const token   = await this.jwt.signAsync(payload);
      res.cookie('accessToken', token, {
        httpOnly: true,
        secure: this.cfg.get('NODE_ENV') === 'production',
        sameSite: 'lax',
        expires: new Date(Date.now() + 3600 * 24 * 7 * 1000),
      });
      return res.redirect('http://localhost:4200/auth/callback');
    } catch (e) {
      return res.redirect('http://localhost:4200/login?error=callback_error');
    }
  }

  // ── Diagnóstico ────────────────────────────────────────────────────────────

  @Get('_diag')
  diag() {
    return {
      google: {
        id:            !!this.cfg.get('GOOGLE_CLIENT_ID'),
        secret:        !!this.cfg.get('GOOGLE_CLIENT_SECRET'),
        callback:      this.cfg.get('GOOGLE_CALLBACK_URL'),
        allowedDomain: this.cfg.get('ALLOWED_GOOGLE_DOMAIN') || null,
      },
      jwt: {
        secret:  !!this.cfg.get('JWT_SECRET'),
        expires: this.cfg.get('JWT_EXPIRES'),
      },
    };
  }
}
