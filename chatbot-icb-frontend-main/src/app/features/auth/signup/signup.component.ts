import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../core/auth.service';

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [CommonModule, RouterLink, MatCardModule, MatButtonModule],
  template: `
    <div style="display:flex;justify-content:center;align-items:center;height:100vh">
      <mat-card style="padding:32px;text-align:center;max-width:400px">
        <h2>Crear cuenta</h2>
        <p>El registro se realiza automáticamente al iniciar sesión con tu cuenta Google de la UDP.</p>
        <button mat-raised-button color="primary" (click)="loginWithGoogle()">
          Entrar con Google (&#64;mail.udp.cl)
        </button>
        <br/><br/>
        <a routerLink="/login">Volver al inicio de sesión</a>
      </mat-card>
    </div>
  `,
})
export class SignUpComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  loginWithGoogle(): void {
    this.auth.signInWithGoogle().catch(err =>
      console.error('[SignUp] signInWithGoogle error:', err)
    );
  }
}
