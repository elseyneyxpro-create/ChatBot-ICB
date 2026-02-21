import { Component, signal, inject } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../../core/auth.service';
import { HttpErrorResponse } from '@angular/common/http';

// Validador personalizado para asegurar que las contraseñas coincidan
export const passwordMatchValidator: ValidatorFn = (control: AbstractControl): { [key: string]: boolean } | null => {
  const password = control.get('password');
  const confirmPassword = control.get('confirmPassword');
  if (password && confirmPassword && password.value !== confirmPassword.value) {
    return { passwordMismatch: true };
  }
  return null;
};

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './signup.component.html',
  styleUrls: ['./signup.component.scss'],
})
export class SignUpComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);

  // Signals para manejar mensajes de éxito y error
  errorMessage = signal<string | null>(null);
  successMessage = signal<string | null>(null);

  // Lógica para mostrar/ocultar contraseña
  hidePassword = signal(true);
  hideConfirmPassword = signal(true);

  form = this.fb.group({
    first_name: ['', [Validators.required]],
    last_name: ['', [Validators.required]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: ['', [Validators.required]],
  }, { validators: passwordMatchValidator }); // Aplicamos el validador personalizado al formulario

  submit(): void {
    if (this.form.invalid) {
      return;
    }

    this.errorMessage.set(null);
    this.successMessage.set(null);

    // Excluimos confirmPassword antes de enviar al backend
    const { confirmPassword, ...userData } = this.form.getRawValue();

    this.auth.signUp(userData).subscribe({
      next: () => {
        this.successMessage.set('¡Registro exitoso! Serás redirigido para iniciar sesión.');
        this.form.reset();
        setTimeout(() => this.router.navigate(['/login']), 3000); // Redirige después de 3 segundos
      },
      error: (err: HttpErrorResponse) => {
        if (err.status === 409) { // 409 Conflict
          this.errorMessage.set('Este correo electrónico ya está en uso.');
        } else {
          this.errorMessage.set('Ocurrió un error inesperado. Por favor, inténtalo de nuevo.');
        }
      },
    });
  }
}