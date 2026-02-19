import { HttpInterceptorFn } from '@angular/common/http';

export const httpAuthInterceptor: HttpInterceptorFn = (req, next) => {
  // Clonamos la petición y le añadimos la opción 'withCredentials'
  const clonedReq = req.clone({
    withCredentials: true,
  });

  // Dejamos pasar la nueva petición clonada
  return next(clonedReq);
};