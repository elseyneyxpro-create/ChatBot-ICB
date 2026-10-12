import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ChatbotHabilitadoGuard } from '../nivelacion/chatbot-habilitado.guard';
import { ProfileService } from './profile.service';

@Controller({ version: '1' })
@UseGuards(AuthGuard('jwt'), ChatbotHabilitadoGuard)
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  /** Estadísticas del usuario autenticado (página de perfil). */
  @Get('profile/stats')
  stats(@Req() req: any) {
    return this.profile.getStats(req.user.sub);
  }

  /** GET /v1/leaderboard?sort=aciertos|uso&tema=Derivadas&limit=50 */
  @Get('leaderboard')
  leaderboard(
    @Query('sort') sort?: string,
    @Query('tema') tema?: string,
    @Query('limit') limit?: string,
  ) {
    const n = Math.min(Math.max(Number(limit) || 50, 1), 100);
    return this.profile.leaderboard(n, sort === 'uso' ? 'uso' : 'aciertos', tema || undefined);
  }

  @Get('leaderboard/top-temas')
  topTemas() {
    return this.profile.top5Temas();
  }
}
