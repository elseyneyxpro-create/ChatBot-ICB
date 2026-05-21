import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class EvaluateConceptoDto {
  @IsString()
  @IsOptional()
  uid?: string;

  @IsString()
  @IsNotEmpty()
  tema!: string;

  @IsString()
  @IsNotEmpty()
  enunciado!: string;

  @IsString()
  @IsNotEmpty()
  respuesta_usuario!: string;

  @IsString()
  @IsOptional()
  id_chat_nr?: string;
}
