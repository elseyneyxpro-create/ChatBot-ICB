import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

@Injectable()
export class FirebaseAdminService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseAdminService.name);

  constructor(private readonly cfg: ConfigService) {}

  onModuleInit() {
    if (admin.apps.length > 0) return; // ya inicializado

    const b64 = this.cfg.getOrThrow<string>('FIREBASE_ADMIN_CREDENTIALS');
    const serviceAccount = JSON.parse(
      Buffer.from(b64, 'base64').toString('utf-8'),
    ) as admin.ServiceAccount;

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    this.logger.log('Firebase Admin SDK inicializado');
  }

  get auth(): admin.auth.Auth {
    return admin.auth();
  }
}
