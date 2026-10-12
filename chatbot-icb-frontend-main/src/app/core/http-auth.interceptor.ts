import { HttpInterceptorFn } from '@angular/common/http';

/**
 * La sesión vive en la cookie httpOnly `accessToken` del backend.
 * Este interceptor solo se asegura de que las llamadas a la API la envíen.
 */
export const httpAuthInterceptor: HttpInterceptorFn = (req, next) =>
  next(req.clone({ withCredentials: true }));
