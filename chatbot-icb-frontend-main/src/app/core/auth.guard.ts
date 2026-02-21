import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { map } from 'rxjs';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const currentUser = authService.currentUser();

  // Caso 1: Ya sabemos que hay un usuario. Acceso inmediato.
  if (currentUser) {
    return true;
  }

  // Caso 2: Ya sabemos que NO hay un usuario. Rechazo inmediato.
  if (currentUser === null) {
    router.navigateByUrl('/login');
    return false;
  }
  
  // Caso 3 (currentUser es 'undefined'): No lo sabemos todavía.
  // El guardia debe tomar el control, verificar, y ESPERAR la respuesta.
  // La ruta no se activará hasta que el observable se complete.
  return authService.checkAuthStatus().pipe(
    map(user => {
      if (user) {
        // La verificación fue exitosa. Permitir acceso.
        return true;
      } else {
        // La verificación falló. Redirigir y denegar acceso.
        router.navigateByUrl('/login');
        return false;
      }
    })
  );
};