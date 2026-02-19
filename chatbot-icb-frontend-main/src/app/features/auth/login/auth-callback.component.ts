// src/app/features/auth/login/auth-callback.component.ts

import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/auth.service'; // 1. Importamos el AuthService

@Component({
  selector: 'app-auth-callback',
  standalone: true,
  template: `<p style="padding:16px">Finalizando inicio de sesión...</p>`,
})
export class AuthCallbackComponent implements OnInit {
  private authService = inject(AuthService); // 2. Inyectamos el servicio
  private router = inject(Router);

  ngOnInit() {
    // 3. CAMBIO CLAVE: En lugar de redirigir ciegamente, le pedimos al AuthService
    // que verifique la sesión AHORA. Esto le da tiempo al navegador de usar la cookie.
    this.authService.checkAuthStatus().subscribe(user => {
      if (user) {
        // Si la verificación es exitosa, el servicio nos da el usuario
        // y AHORA sí redirigimos a la aplicación.
        this.router.navigateByUrl('/app');
      } else {
        // Si por alguna razón la verificación falla, lo enviamos al login
        // con un mensaje de error.
        this.router.navigateByUrl('/login?error=auth_failed');
      }
    });
  }
}