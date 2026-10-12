import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const user = await auth.ensureSession();
  return user ? true : router.parseUrl('/login');
};

/** Chatbot normal: si el alumno aún no lo tiene habilitado, lo manda a la nivelación. */
export const chatbotGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const user = await auth.ensureSession();
  if (!user) return router.parseUrl('/login');
  return user.chatbotHabilitado ? true : router.parseUrl('/nivelacion');
};
