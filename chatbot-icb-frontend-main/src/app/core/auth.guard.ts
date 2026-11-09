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
  return user.chatbotHabilitado || auth.esProfesor() ? true : router.parseUrl('/nivelacion');
};

/** Nivelación: solo alumnos (y dev viendo como alumno). Los profesores van a su panel. */
export const nivelacionGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const user = await auth.ensureSession();
  if (!user) return router.parseUrl('/login');
  return auth.esProfesor() ? router.parseUrl('/profesor') : true;
};

/** Panel docente: profesores (staff) y dev viendo como profesor. El backend vuelve a validarlo. */
export const staffGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const user = await auth.ensureSession();
  if (!user) return router.parseUrl('/login');
  return auth.esProfesor() ? true : router.parseUrl('/app');
};
