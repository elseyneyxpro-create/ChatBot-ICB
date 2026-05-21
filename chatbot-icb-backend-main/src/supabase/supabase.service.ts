import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private readonly client: SupabaseClient;

  constructor(private readonly cfg: ConfigService) {
    const url = this.cfg.getOrThrow<string>('SUPABASE_URL');
    const key = this.cfg.getOrThrow<string>('SUPABASE_SERVICE_KEY');
    this.client = createClient(url, key);
  }

  get db(): SupabaseClient {
    return this.client;
  }
}
