import { Injectable } from '@angular/core';
import { createClient, SupabaseClient, Session } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SupabaseAuthService {
  private readonly client: SupabaseClient;

  constructor() {
    this.client = createClient(
      environment.supabase.url,
      environment.supabase.anonKey,
      {
        auth: {
          // navigator.locks puede fallar en contextos de extensiones del browser.
          // Este lock personalizado hace fallback a ejecución directa sin bloqueo.
          lock: <T>(_name: string, _acquireTimeout: number, fn: () => Promise<T>): Promise<T> => fn(),
        },
      },
    );
  }

  /** Inicia el flujo OAuth con Google via Supabase. Redirige al browser. */
  async signInWithGoogle(): Promise<void> {
    await this.client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  }

  /**
   * Obtiene la sesión después del callback OAuth.
   * Supabase v2 con PKCE necesita procesar el `code` de la URL antes
   * de que getSession() devuelva algo — esperamos el evento SIGNED_IN.
   */
  getSessionAfterCallback(): Promise<Session | null> {
    return new Promise((resolve) => {
      // Primero intenta sincrónicamente (por si ya está procesado)
      this.client.auth.getSession().then(({ data }) => {
        if (data.session) {
          resolve(data.session);
          return;
        }

        // Espera el evento SIGNED_IN que Supabase emite al procesar el code
        const { data: { subscription } } = this.client.auth.onAuthStateChange(
          (event, session) => {
            if (event === 'SIGNED_IN' && session) {
              subscription.unsubscribe();
              resolve(session);
            }
          },
        );

        // Timeout de seguridad: 10 segundos
        setTimeout(() => {
          subscription.unsubscribe();
          resolve(null);
        }, 10_000);
      });
    });
  }

  /** Cierra la sesión en Supabase. */
  async signOut(): Promise<void> {
    await this.client.auth.signOut();
  }
}
