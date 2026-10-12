import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MongoService } from '../../database/mongo.service';

/**
 * Chats e hilos en MongoDB (antes los leía/escribía el frontend directo en Firestore).
 * Se mantienen los mismos nombres de colección y campos para que el servicio Python
 * y los datos migrados sigan funcionando igual.
 */
@Injectable()
export class ChatsService {
  constructor(private readonly mongo: MongoService) {}

  private get chats() { return this.mongo.col('Chat_nr'); }
  private get hilos() { return this.mongo.col('Hilo_chat'); }

  /** Lanza 404/403 si el chat no existe o no es del usuario. Devuelve el documento. */
  async assertOwner(chatId: string, uid: string) {
    const chat = await this.chats.findOne({ _id: chatId });
    if (!chat) throw new NotFoundException('Chat no encontrado.');
    if (chat['uid'] !== uid) throw new ForbiddenException('Este chat no te pertenece.');
    return chat;
  }

  async list(uid: string) {
    const docs = await this.chats.find({ uid }).sort({ created_at: -1 }).toArray();
    return docs.map((d) => this.mapChat(d));
  }

  async get(chatId: string, uid: string) {
    return this.mapChat(await this.assertOwner(chatId, uid));
  }

  async create(uid: string, nombre: string) {
    const doc = {
      _id: this.mongo.newId(),
      uid,
      nombre,
      id_head: '',
      id_tail: '',
      total_hilos: 0,
      created_at: new Date(),
    };
    await this.chats.insertOne(doc);
    return this.mapChat(doc);
  }

  async rename(chatId: string, uid: string, nombre: string) {
    await this.assertOwner(chatId, uid);
    await this.chats.updateOne({ _id: chatId }, { $set: { nombre } });
    return { ok: true };
  }

  async remove(chatId: string, uid: string) {
    await this.assertOwner(chatId, uid);
    await this.hilos.deleteMany({ id_chat_nr: chatId });
    await this.mongo.col('Contexto_chat').deleteOne({ _id: chatId });
    await this.chats.deleteOne({ _id: chatId });
    return { ok: true };
  }

  async saveLastVideos(chatId: string, uid: string, videos: any[]) {
    await this.assertOwner(chatId, uid);
    await this.chats.updateOne({ _id: chatId }, { $set: { last_videos: videos } });
    return { ok: true };
  }

  async appendHilo(
    chatId: string,
    uid: string,
    dto: { input: string; output: string; tema?: string | null; ejemplo_videos?: string[] },
  ) {
    const chat = await this.assertOwner(chatId, uid);
    const newCount = (chat['total_hilos'] ?? 0) + 1;
    const hiloId = this.mongo.newId();

    await this.hilos.insertOne({
      _id: hiloId,
      id_chat_nr: chatId,
      tipo: 'respuesta',
      input: dto.input,
      output: dto.output,
      tema: dto.tema ?? null,
      count: newCount,
      id_next: '',
      created_at: new Date(),
      ejemplo_videos: dto.ejemplo_videos ?? [],
      reinforcement: null,
    });

    if (chat['id_tail']) {
      await this.hilos.updateOne({ _id: chat['id_tail'] }, { $set: { id_next: hiloId } });
    }

    await this.chats.updateOne(
      { _id: chatId },
      {
        $set: { id_tail: hiloId, ...(chat['id_head'] ? {} : { id_head: hiloId }) },
        $inc: { total_hilos: 1 },
      },
    );

    return { count: newCount, hiloId };
  }

  async loadHistory(chatId: string, uid: string) {
    await this.assertOwner(chatId, uid);
    const docs = await this.hilos.find({ id_chat_nr: chatId }).sort({ created_at: 1 }).toArray();
    return docs.map(({ _id, ...rest }) => ({ id: _id, ...rest }));
  }

  /** Guarda el reinforcement en el último hilo (id_tail). */
  async updateHiloReinforcement(chatId: string, uid: string, reinforcement: Record<string, any>) {
    const chat = await this.assertOwner(chatId, uid);
    if (!chat['id_tail']) return { ok: false };
    await this.hilos.updateOne({ _id: chat['id_tail'] }, { $set: { reinforcement } });
    return { ok: true };
  }

  /** Marca un ejercicio como respondido en Hilo_chat.reinforcement y en Chat_nr.last_reinforcement. */
  async updateHiloEjercicio(
    chatId: string,
    hiloId: string,
    uid: string,
    update: { tipo: string; es_correcto: boolean; respuesta_alumno: any; feedback?: string },
  ) {
    const chat = await this.assertOwner(chatId, uid);
    const hilo = await this.hilos.findOne({ _id: hiloId, id_chat_nr: chatId });

    const applyUpdate = (ejercicios: any[]) =>
      ejercicios.map((ej) =>
        ej.tipo !== update.tipo
          ? ej
          : {
              ...ej,
              respondido: true,
              es_correcto: update.es_correcto,
              respuesta_alumno: update.respuesta_alumno,
              ...(update.feedback !== undefined ? { feedback: update.feedback } : {}),
            },
      );

    const writes: Promise<unknown>[] = [];
    const hiloR = hilo?.['reinforcement'];
    if (hiloR?.ejercicios) {
      writes.push(this.hilos.updateOne(
        { _id: hiloId },
        { $set: { reinforcement: { ...hiloR, ejercicios: applyUpdate(hiloR.ejercicios) } } },
      ));
    }
    const lastR = chat['last_reinforcement'];
    if (lastR?.ejercicios) {
      writes.push(this.chats.updateOne(
        { _id: chatId },
        { $set: { last_reinforcement: { ...lastR, ejercicios: applyUpdate(lastR.ejercicios) } } },
      ));
    }
    await Promise.all(writes);
    return { ok: true };
  }

  private mapChat(d: any) {
    return {
      id: d._id,
      uid: d.uid,
      nombre: d.nombre,
      id_head: d.id_head ?? '',
      id_tail: d.id_tail ?? '',
      total_hilos: d.total_hilos ?? 0,
      created_at: d.created_at,
      last_reinforcement: d.last_reinforcement ?? null,
      last_videos: d.last_videos ?? [],
    };
  }
}
