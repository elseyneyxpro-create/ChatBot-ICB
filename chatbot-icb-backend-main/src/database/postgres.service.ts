import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, QueryResultRow } from 'pg';

/**
 * Conexión a PostgreSQL (reemplaza a SupabaseService).
 * La base relacional tiene las tablas que venían de Supabase:
 * usuario, whitelist_alumnos, tema, contenido_tema, videos (+ pgvector).
 */
@Injectable()
export class PostgresService implements OnModuleDestroy {
  private readonly logger = new Logger(PostgresService.name);
  private readonly pool: Pool;

  constructor(private readonly cfg: ConfigService) {
    this.pool = new Pool({
      connectionString: this.cfg.getOrThrow<string>('DATABASE_URL'),
      max: 10,
    });
    this.pool.on('error', (err) => this.logger.error(`Error en pool de Postgres: ${err.message}`));
  }

  async query<T extends QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const { rows } = await this.pool.query<T>(sql, params);
    return rows;
  }

  async queryOne<T extends QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
