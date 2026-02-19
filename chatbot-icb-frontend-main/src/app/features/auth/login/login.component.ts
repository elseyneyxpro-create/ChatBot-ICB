import { Component, signal, inject, OnInit } from '@angular/core';
import { Router, ActivatedRoute, RouterLink } from '@angular/router'; // 1. Importamos RouterLink para el enlace de registro
import { AuthService } from '../../../core/auth.service';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink, // 2. Añadimos RouterLink a los imports
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
  ],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent implements OnInit {
  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private auth = inject(AuthService);

  contactEmail = 'chatbot-desarrollo@mail.udp.cl';
  errorMessage = signal<string | null>(null);

  private _hide = true;
  hide = () => this._hide;
  toggleHide = () => this._hide = !this._hide;

  // Hacemos que el campo de email requiera un formato de correo válido.
  form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      const error = params['error'];
      if (error === 'domain_not_allowed') {
        this.errorMessage.set('Acceso denegado. Debes usar una cuenta @mail.udp.cl.');
      } else if (error) {
        this.errorMessage.set('Ocurrió un error inesperado. Por favor, inténtalo de nuevo.');
      }
    });
  }

  /**
   * Maneja el envío del formulario de inicio de sesión.
   */
  submit(): void {
    if (this.form.invalid) return;
    
    this.errorMessage.set(null); // Limpiamos errores previos
    const credentials = this.form.getRawValue();

    this.auth.signIn(credentials).subscribe({
      // El éxito es manejado por el propio servicio, que nos redirigirá a /app
      error: (err: HttpErrorResponse) => {
        // Si el backend devuelve un 401 (Unauthorized), mostramos un error amigable.
        if (err.status === 401) {
          this.errorMessage.set('Correo o contraseña incorrectos.');
        } else {
          // Para cualquier otro error, mostramos un mensaje genérico.
          this.errorMessage.set('Ocurrió un error en el servidor. Inténtalo más tarde.');
        }
      },
    });
  }

  /**
   * Redirige al flujo de autenticación de Google.
   */
  loginWithGoogle(): void {
    window.location.href = 'http://127.0.0.1:3000/auth/google';
  }
}