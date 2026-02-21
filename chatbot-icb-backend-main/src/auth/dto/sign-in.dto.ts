import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class SignInDto {
  @IsEmail({}, { message: 'El correo electrónico no es válido.' })
  @IsNotEmpty({ message: 'El correo electrónico es requerido.' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'La contraseña es requerida.' })
  password: string;
}