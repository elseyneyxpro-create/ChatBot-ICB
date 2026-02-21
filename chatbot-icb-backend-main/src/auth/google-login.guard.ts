import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GoogleLoginGuard extends AuthGuard('google') {
  /**
   * Sobrescribimos el método que maneja la respuesta de la estrategia.
   * En lugar de lanzar una excepción si el usuario no es válido (ej: por dominio incorrecto),
   * simplemente pasamos 'null' al controlador para que él decida qué hacer.
   */
  handleRequest(err: any, user: any, info: any, context: any) {
    if (err || !user) {
      return null; // Devolvemos null en lugar de lanzar un error
    }
    return user;
  }
}