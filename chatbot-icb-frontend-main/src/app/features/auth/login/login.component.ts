import { Component, signal, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../../../core/auth.service';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { CommonModule } from '@angular/common';

const ERROR_MESSAGES: Record<string, string> = {
  not_authorized: 'Tu cuenta no está en nuestros registros. Contacta al administrador.',
  auth_failed:    'Ocurrió un error al iniciar sesión. Inténtalo de nuevo.',
  domain_not_allowed: 'Solo se permiten cuentas @mail.udp.cl.',
};

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent implements OnInit {
  private auth  = inject(AuthService);
  private route = inject(ActivatedRoute);

  errorMessage = signal<string | null>(null);

  ngOnInit(): void {
    const errorCode = this.route.snapshot.queryParamMap.get('error');
    if (errorCode) {
      this.errorMessage.set(ERROR_MESSAGES[errorCode] ?? 'Error al iniciar sesión. Inténtalo de nuevo.');
    }
  }

  loginWithGoogle(): void {
    this.errorMessage.set(null);
    this.auth.signInWithGoogle().catch(err =>
      this.errorMessage.set(err?.message ?? 'Error al iniciar sesión con Google. Inténtalo de nuevo.')
    );
  }
}
