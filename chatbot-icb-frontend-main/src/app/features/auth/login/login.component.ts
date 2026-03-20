import { Component, signal, inject } from '@angular/core';
import { AuthService } from '../../../core/auth.service';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { CommonModule } from '@angular/common';

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
export class LoginComponent {
  private auth = inject(AuthService);
  errorMessage = signal<string | null>(null);

  loginWithGoogle(): void {
    this.auth.signInWithGoogle().subscribe({
      error: () => this.errorMessage.set('Error al iniciar sesión con Google. Inténtalo de nuevo.')
    });
  }
}
