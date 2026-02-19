import { ValidationPipe, VersioningType, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';

function parseCorsOrigins(): string[] | true {
  const raw = process.env.CORS_ORIGINS || '';
  const list = raw.split(',').map(s => s.trim()).filter(Boolean);
  return list.length ? list : true;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  console.log('ENV:', {
    GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL,
    JWT_SECRET: !!process.env.JWT_SECRET,
    JWT_EXPIRES: process.env.JWT_EXPIRES,
  });

  app.use(helmet());
  app.use(compression());
  app.use(cookieParser());

  app.enableCors({ origin: parseCorsOrigins(), credentials: true });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }));

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');

  new Logger('Bootstrap').log(`🚀 BFF ICB Chatbot up on :${port}`);
}

bootstrap().catch((err) => {
  const logger = new Logger('Bootstrap');
  logger.error('❌ Error starting the app', err);
  process.exit(1);
});