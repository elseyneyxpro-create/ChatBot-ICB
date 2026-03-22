import { Injectable, signal, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Auth, GoogleAuthProvider, signInWithPopup, signOut, deleteUser, user } from '@angular/fire/auth';
import { Observable, from, of } from 'rxjs';
import { tap, catchError, map, switchMap } from 'rxjs/operators';

const ALLOWED_DOMAIN = 'mail.udp.cl';

export interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private auth = inject(Auth);
  private router = inject(Router);

  // Tres estados posibles:
  // undefined: Aún no sabemos (estado inicial).
  // null: Sabemos que NO hay sesión.
  // User: Sabemos que SÍ hay sesión.
  private _currentUser = signal<User | undefined | null>(undefined);
  public currentUser = this._currentUser.asReadonly();

  constructor() {
    // Firebase notifica automáticamente cuando cambia el estado de auth
    user(this.auth).subscribe(firebaseUser => {
      if (firebaseUser) {
        this._currentUser.set({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
          photoURL: firebaseUser.photoURL,
        });
      } else {
        this._currentUser.set(null);
      }
    });
  }

  signInWithGoogle(): Observable<any> {
    const provider = new GoogleAuthProvider();
    return from(signInWithPopup(this.auth, provider)).pipe(
      switchMap(result => {
        const email = result.user?.email ?? '';
        if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
          return from(deleteUser(result.user)).pipe(
            switchMap(() => from(signOut(this.auth))),
            map(() => { throw new Error(`Solo se permiten correos @${ALLOWED_DOMAIN}`); }),
          );
        }
        this.router.navigateByUrl('/app');
        return of(result);
      }),
      catchError(err => { throw err; }),
    );
  }

  signOut(): void {
    from(signOut(this.auth)).subscribe({
      complete: () => {
        this._currentUser.set(null);
        this.router.navigateByUrl('/login');
      }
    });
  }
}
