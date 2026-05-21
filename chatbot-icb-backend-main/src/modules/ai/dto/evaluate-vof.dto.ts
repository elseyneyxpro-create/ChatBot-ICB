import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class EvaluateVofDto {
  @IsString()
  @IsOptional()
  uid?: string;

  @IsString()
  @IsNotEmpty()
  tema!: string;

  @IsString()
  @IsNotEmpty()
  enunciado!: string;

  @IsBoolean()
  respuesta_usuario!: boolean;

  @IsBoolean()
  respuesta_correcta!: boolean;

  @IsString()
  @IsOptional()
  id_chat_nr?: string;
}
