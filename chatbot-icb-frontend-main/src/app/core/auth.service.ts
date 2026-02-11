import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private _isAuthed = signal<boolean>(false);
  isAuthed = this._isAuthed.asReadonly();
  // Mock: guarda solo en memoria
  login(email: string, pass: string) {
    // aquí llamarías a tu API /auth/login
    if (email && pass) this._isAuthed.set(true);
  }
  logout() { this._isAuthed.set(false); }
}
