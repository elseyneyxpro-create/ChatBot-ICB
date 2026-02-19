import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  // Sobrescribimos este método para añadir opciones de ejecución
  getAuthenticateOptions(context: ExecutionContext) {
    // Aquí le decimos a Passport que siempre pida al usuario que seleccione una cuenta
    return { prompt: 'select_account' };
  }
}