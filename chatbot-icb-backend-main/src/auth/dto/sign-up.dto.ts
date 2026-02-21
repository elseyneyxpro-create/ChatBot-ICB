import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class SignUpDto {
  @IsEmail({}, { message: 'El correo electrónico no es válido.' })
  @IsNotEmpty({ message: 'El correo electrónico es requerido.' })
  email: string;

  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  @IsNotEmpty({ message: 'La contraseña es requerida.' })
  password: string;

  @IsString()
  @IsOptional()
  first_name?: string;

  @IsString()
  @IsOptional()
  last_name?: string;

  @IsString()
  @IsOptional()
  rut?: string;
}