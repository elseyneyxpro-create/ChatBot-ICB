import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ChatbotHabilitadoGuard } from '../nivelacion/chatbot-habilitado.guard';
import { ChatsService } from './chats.service';
import {
  AppendHiloDto, CreateChatDto, LastVideosDto, ReinforcementDto, RenameChatDto, UpdateEjercicioDto,
} from './chats.dto';

/** Endpoints que reemplazan las lecturas/escrituras directas del frontend a Firestore. */
@Controller({ path: 'chats', version: '1' })
@UseGuards(AuthGuard('jwt'), ChatbotHabilitadoGuard)
export class ChatsController {
  constructor(private readonly chats: ChatsService) {}

  @Get()
  list(@Req() req: any) {
    return this.chats.list(req.user.sub);
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateChatDto) {
    return this.chats.create(req.user.sub, dto.nombre);
  }

  @Get(':id')
  get(@Req() req: any, @Param('id') id: string) {
    return this.chats.get(id, req.user.sub);
  }

  @Patch(':id')
  rename(@Req() req: any, @Param('id') id: string, @Body() dto: RenameChatDto) {
    return this.chats.rename(id, req.user.sub, dto.nombre);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.chats.remove(id, req.user.sub);
  }

  @Put(':id/last-videos')
  @HttpCode(200)
  lastVideos(@Req() req: any, @Param('id') id: string, @Body() dto: LastVideosDto) {
    return this.chats.saveLastVideos(id, req.user.sub, dto.videos);
  }

  @Get(':id/hilos')
  history(@Req() req: any, @Param('id') id: string) {
    return this.chats.loadHistory(id, req.user.sub);
  }

  @Post(':id/hilos')
  appendHilo(@Req() req: any, @Param('id') id: string, @Body() dto: AppendHiloDto) {
    return this.chats.appendHilo(id, req.user.sub, dto);
  }

  @Put(':id/reinforcement')
  @HttpCode(200)
  reinforcement(@Req() req: any, @Param('id') id: string, @Body() dto: ReinforcementDto) {
    return this.chats.updateHiloReinforcement(id, req.user.sub, dto.reinforcement);
  }

  @Patch(':id/hilos/:hiloId/ejercicio')
  ejercicio(
    @Req() req: any,
    @Param('id') id: string,
    @Param('hiloId') hiloId: string,
    @Body() dto: UpdateEjercicioDto,
  ) {
    return this.chats.updateHiloEjercicio(id, hiloId, req.user.sub, dto);
  }
}
