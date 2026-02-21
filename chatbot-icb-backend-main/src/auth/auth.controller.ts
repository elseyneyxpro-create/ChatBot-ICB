import { Controller, Get, Post, Body, Req, Res, UseGuards, VERSION_NEUTRAL, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { SignUpDto } from './dto/sign-up.dto';
import { SignInDto } from './dto/sign-in.dto';
import { GoogleAuthGuard } from './google.guard';
import { GoogleLoginGuard } from './google-login.guard';

@Controller({ path: 'auth', version: VERSION_NEUTRAL })
export class AuthController {
  constructor(
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
    private readonly authService: AuthService,
  ) {}

  // --- RUTA PROTEGIDA PARA VERIFICAR SESIÓN ---
  @Get('profile')
  @UseGuards(AuthGuard('jwt'))
  getProfile(@Req() req: Request) {
    return req.user;
  }

  // --- ENDPOINTS PÚBLICOS DE AUTENTICACIÓN ---

  @Post('signin')
  @HttpCode(HttpStatus.OK)
  async signIn(
    @Body() signInDto: SignInDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { access_token } = await this.authService.signIn(signInDto.email, signInDto.password);

    response.cookie('accessToken', access_token, {
      httpOnly: true,
      secure: this.cfg.get('NODE_ENV') === 'production',
      // 👇 CAMBIO CLAVE: Permite la cookie en redirects entre puertos.
      sameSite: 'lax',
      expires: new Date(Date.now() + 3600 * 24 * 7 * 1000), // 7 días
    });

    return { status: 'success', message: 'Inicio de sesión exitoso.' };
  }

  @Post('signup')
  async signUp(@Body() signUpDto: SignUpDto) {
    const { password, ...rest } = signUpDto;
    const userData = {
      ...rest,
      password_hash: password,
    };
    return this.authService.signUp(userData);
  }

  @Post('signout')
  @HttpCode(HttpStatus.OK)
  signOut(@Res({ passthrough: true }) response: Response) {
    response.clearCookie('accessToken', {
      httpOnly: true,
      secure: this.cfg.get('NODE_ENV') === 'production',
      // 👇 CAMBIO CLAVE: Consistente en el cierre de sesión.
      sameSite: 'lax',
    });
    return { status: 'success', message: 'Sesión cerrada exitosamente.' };
  }

  // --- ENDPOINTS DE GOOGLE Y DIAGNÓSTICO ---

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

      const payload = {
        sub: req.user.sub,
        email: req.user.email,
        name: req.user.name,
        picture: req.user.picture,
        roles: ['user'],
      };

      const token = await this.jwt.signAsync(payload);
      
      res.cookie('accessToken', token, {
        httpOnly: true,
        secure: this.cfg.get('NODE_ENV') === 'production',
        // 👇 CAMBIO CLAVE: Permite la cookie en redirects entre puertos.
        sameSite: 'lax',
        expires: new Date(Date.now() + 3600 * 24 * 7 * 1000),
      });
      
      return res.redirect('http://localhost:4200/auth/callback');

    } catch (e) {
      console.error('google/callback error:', e);
      return res.redirect('http://localhost:4200/login?error=callback_error');
    }
  }

  @Get('_diag')
  diag() {
    return {
      google: {
        id: !!this.cfg.get('GOOGLE_CLIENT_ID'),
        secret: !!this.cfg.get('GOOGLE_CLIENT_SECRET'),
        callback: this.cfg.get('GOOGLE_CALLBACK_URL'),
        allowedDomain: this.cfg.get('ALLOWED_GOOGLE_DOMAIN') || null,
      },
      jwt: {
        secret: !!this.cfg.get('JWT_SECRET'),
        expires: this.cfg.get('JWT_EXPIRES'),
      },
    };
  }
}