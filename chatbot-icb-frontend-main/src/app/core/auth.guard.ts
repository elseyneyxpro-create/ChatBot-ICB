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

/** Panel docente: solo staff (whitelist_alumnos.codigo_asignatura = staff/crack). El backend vuelve a validarlo. */
export const staffGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const user = await auth.ensureSession();
  if (!user) return router.parseUrl('/login');
  return user.rol === 'staff' ? true : router.parseUrl('/app');
};
