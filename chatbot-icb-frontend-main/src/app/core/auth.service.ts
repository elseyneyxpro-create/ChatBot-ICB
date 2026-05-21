import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import {
  Auth,
  signInWithCustomToken,
  signOut,
  updateProfile,
} from '@angular/fire/auth';
import { firstValueFrom } from 'rxjs';
import { FirestoreService } from './firestore.service';
import { SupabaseAuthService } from './supabase-auth.service';
import { environment } from '../../environments/environment';

export interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth    = inject(Auth);
  private readonly http    = inject(HttpClient);
  private readonly router  = inject(Router);
  private readonly fs      = inject(FirestoreService);
  private readonly supa    = inject(SupabaseAuthService);

  private _currentUser = signal<User | undefined | null>(undefined);
  public  currentUser  = this._currentUser.asReadonly();

  /**
   * Paso 1 del login — lanza el OAuth de Google via Supabase.
   * El browser redirige a Google y vuelve a /auth/callback.
   */
  async signInWithGoogle(): Promise<void> {
    await this.supa.signInWithGoogle();
  }

  /**
   * Paso 2 del login — llamado desde /auth/callback después del redirect.
   * Intercambia el Supabase token por cookie NestJS + Firebase custom token.
   * NO navega — la navegación queda a cargo del componente que lo llama.
   */
  async handleOAuthCallback(): Promise<void> {
    const session = await this.supa.getSessionAfterCallback();
    if (!session?.access_token) {
      throw new Error('No se encontró sesión de Supabase tras el callback.');
    }

    // Llama al BFF → setea cookie httpOnly + devuelve Firebase custom token
    // Puede lanzar HttpErrorResponse con status 403 si la cuenta no está autorizada.
    const result = await firstValueFrom(
      this.http.post<{ ok: boolean; firebaseCustomToken: string; user: any }>(
        environment.auth.exchangeUrl,
        {},
        { headers: { Authorization: `Bearer ${session.access_token}` }, withCredentials: true },
      ),
    );

    if (!result.ok) throw new Error('Exchange falló en el backend.');

    // Inicia sesión en Firebase con el custom token → Firestore disponible
    // NOTA: signInWithCustomToken NO trae displayName/email/photoURL de Google,
    // por eso los tomamos directamente de result.user (que vienen de Supabase metadata).
    const fbCred     = await signInWithCustomToken(this.auth, result.firebaseCustomToken);
    const nombre     = result.user.nombre   ?? fbCred.user.displayName ?? null;
    const photoURL   = result.user.photoURL ?? fbCred.user.photoURL    ?? null;
    const email      = result.user.email    ?? fbCred.user.email;

    // Persiste nombre y foto en el perfil de Firebase Auth para que sobrevivan recarga
    if (nombre || photoURL) {
      await updateProfile(fbCred.user, {
        displayName: nombre    ?? undefined,
        photoURL:    photoURL  ?? undefined,
      }).catch(e => console.warn('[AuthService] updateProfile falló:', e));
    }

    this._currentUser.set({ uid: fbCred.user.uid, email, displayName: nombre, photoURL });

    // Persiste nombre/foto en Firestore
    this.fs.saveUserProfile(nombre, photoURL)
      .catch(e => console.warn('[AuthService] saveUserProfile falló:', e));
  }

  /** Navega a la pantalla de despedida — el sign-out real ocurre después. */
  signOut(): void {
    this.router.navigateByUrl('/logout');
  }

  /** Cierra sesión efectivamente en Supabase y Firebase (llamado desde LogoutScreenComponent). */
  doSignOut(): void {
    Promise.all([
      signOut(this.auth),
      this.supa.signOut(),
    ]).then(() => {
      this._currentUser.set(null);
      this.router.navigateByUrl('/login');
    });
  }

  /** Restaura el usuario desde Firebase si ya hay sesión activa (reload de página). */
  restoreSession(firebaseUser: any): void {
    if (firebaseUser) {
      this._currentUser.set({
        uid:         firebaseUser.uid,
        email:       firebaseUser.email,
        displayName: firebaseUser.displayName,
        photoURL:    firebaseUser.photoURL,
      });
    } else {
      this._currentUser.set(null);
    }
  }
}
