import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  /** false → solo puede ver la nivelación */
  chatbotHabilitado: boolean;
}

interface ProfileResponse {
  uid: string;
  email: string;
  name: string | null;
  picture: string | null;
  chatbot_habilitado?: boolean;
}

/**
 * Sesión basada solo en la cookie httpOnly `accessToken` que emite el backend NestJS.
 * (Antes: Supabase Auth para el OAuth + Firebase Auth con custom token.)
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http   = inject(HttpClient);
  private readonly router = inject(Router);

  /** undefined = todavía no se sabe; null = sin sesión. */
  private _currentUser = signal<User | undefined | null>(undefined);
  public  currentUser  = this._currentUser.asReadonly();

  private sessionPromise: Promise<User | null> | null = null;

  /**
   * Paso 1 del login — redirige al backend, que lanza el OAuth de Google.
   * Google vuelve al backend (/api/auth/google/callback), este setea la cookie
   * y redirige a /auth/callback.
   */
  async signInWithGoogle(): Promise<void> {
    window.location.href = environment.auth.loginUrl;
  }

  /**
   * Paso 2 del login — llamado desde /auth/callback.
   * La cookie ya viene seteada; solo se carga el perfil.
   */
  async handleOAuthCallback(): Promise<void> {
    const user = await this.loadSession(true);
    if (!user) throw new Error('No se encontró sesión tras el login con Google.');
  }

  /** Devuelve el usuario si hay sesión válida (cachea la consulta). Lo usa el guard. */
  ensureSession(): Promise<User | null> {
    const current = this._currentUser();
    if (current !== undefined) return Promise.resolve(current);
    return this.loadSession();
  }

  /** Consulta /auth/profile para saber si la cookie sigue siendo válida. */
  loadSession(force = false): Promise<User | null> {
    if (this.sessionPromise && !force) return this.sessionPromise;
    this.sessionPromise = firstValueFrom(
      this.http.get<ProfileResponse>(`${environment.API_URL}/auth/profile`, { withCredentials: true }),
    )
      .then(p => {
        const user: User = {
          uid: p.uid, email: p.email, displayName: p.name, photoURL: p.picture,
          chatbotHabilitado: p.chatbot_habilitado !== false,
        };
        this._currentUser.set(user);
        return user;
      })
      .catch(() => {
        this._currentUser.set(null);
        return null;
      })
      .finally(() => { this.sessionPromise = null; });
    return this.sessionPromise;
  }

  /** Navega a la pantalla de despedida — el sign-out real ocurre después. */
  signOut(): void {
    this.router.navigateByUrl('/logout');
  }

  /** Cierra la sesión en el backend (borra la cookie). Llamado desde LogoutScreenComponent. */
  doSignOut(): void {
    firstValueFrom(this.http.post(`${environment.API_URL}/auth/signout`, {}, { withCredentials: true }))
      .catch(e => console.warn('[AuthService] signout falló:', e))
      .finally(() => {
        this._currentUser.set(null);
        this.router.navigateByUrl('/login');
      });
  }

  /** Restaura la sesión al cargar la app (recarga de página). */
  restoreSession(): void {
    this.loadSession();
  }
}
