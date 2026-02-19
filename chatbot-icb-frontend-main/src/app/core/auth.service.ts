import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';
import { tap, catchError, of, Observable, switchMap } from 'rxjs';

export interface User {
  sub: string;
  email: string;
  iat?: number;
  exp?: number;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private readonly API_URL = environment.API_URL;

  // Tres estados posibles:
  // undefined: Aún no sabemos (estado inicial).
  // null: Sabemos que NO hay sesión.
  // User: Sabemos que SÍ hay sesión.
  private _currentUser = signal<User | undefined | null>(undefined);
  public currentUser = this._currentUser.asReadonly();

  constructor() {
    // Al iniciar, intentamos verificar la sesión para poblar el estado inicial.
    this.checkAuthStatus().subscribe();
  }

  /**
   * Llama al endpoint /profile para obtener los datos del usuario.
   * Actualiza el estado interno con el resultado.
   */
  checkAuthStatus(): Observable<User | null> {
    return this.http.get<User>(`${this.API_URL}/auth/profile`).pipe(
      tap(user => this._currentUser.set(user)),
      catchError(() => {
        this._currentUser.set(null);
        return of(null); // Devuelve un observable de 'null' en caso de error
      })
    );
  }

  /**
   * Llama al endpoint de signin y, si tiene éxito, verifica la sesión
   * y redirige al usuario.
   */
  signIn(credentials: { email: string; password: string }): Observable<any> {
    return this.http.post(`${this.API_URL}/auth/signin`, credentials).pipe(
      switchMap(() => this.checkAuthStatus()),
      tap(user => {
        if (user) {
          this.router.navigateByUrl('/app');
        }
      })
    );
  }

  /**
   * Llama al endpoint de signup.
   */
  signUp(userData: any): Observable<any> {
    return this.http.post(`${this.API_URL}/auth/signup`, userData);
  }

  /**
   * Cierra la sesión en el backend y limpia el estado local.
   */
  signOut(): void {
    this.http.post(`${this.API_URL}/auth/signout`, {}).subscribe({
      complete: () => {
        this._currentUser.set(null);
        this.router.navigateByUrl('/login');
      }
    });
  }
}