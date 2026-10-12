import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Collection, Db, Document, MongoClient, ObjectId } from 'mongodb';

/**
 * Conexión a MongoDB (reemplaza a Firestore).
 *
 * Colecciones (mismos nombres que en Firestore):
 *  - Chat_nr, Hilo_chat, Contexto_chat, Perfil_usuario  → _id string (mismo id que tenían en Firestore)
 *  - nivel_usuario → antes subcolección Perfil_usuario/{uid}/nivel_usuario/{tema};
 *                    ahora colección plana con { uid, tema, ... } e índice único (uid, tema)
 */
@Injectable()
export class MongoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MongoService.name);
  private readonly client: MongoClient;
  private database!: Db;

  constructor(private readonly cfg: ConfigService) {
    this.client = new MongoClient(this.cfg.get<string>('MONGO_URL') ?? 'mongodb://localhost:27017');
  }

  async onModuleInit() {
    await this.client.connect();
    this.database = this.client.db(this.cfg.get<string>('MONGO_DB') ?? 'icb_chatbot');
    const indices: [string, Record<string, 1 | -1>, Record<string, unknown>?][] = [
      ['Chat_nr', { uid: 1, created_at: -1 }],
      ['Hilo_chat', { id_chat_nr: 1, created_at: 1 }],
      ['nivel_usuario', { uid: 1, tema: 1 }, { unique: true }],
      ['nivel_usuario', { tema: 1 }],
      // Preguntas generadas en modo Entrenar: se borran solas a las 2 horas si nadie las responde
      ['niv_generadas', { created_at: 1 }, { expireAfterSeconds: 7200 }],
    ];
    // Un índice que falle no debe impedir que el backend arranque
    for (const [col, keys, opts] of indices) {
      await this.col(col).createIndex(keys, opts ?? {})
        .catch((e) => this.logger.warn(`No se pudo crear índice en ${col}: ${e.message}`));
    }
    this.logger.log('MongoDB conectado');
  }

  async onModuleDestroy() {
    await this.client.close();
  }

  /** Colección con _id string (como los ids de Firestore). */
  col<T extends Document = Document>(name: string): Collection<T & { _id: string }> {
    return this.database.collection<T & { _id: string }>(name);
  }

  /** Genera un id string nuevo (equivalente a los ids autogenerados de Firestore). */
  newId(): string {
    return new ObjectId().toHexString();
  }
}
