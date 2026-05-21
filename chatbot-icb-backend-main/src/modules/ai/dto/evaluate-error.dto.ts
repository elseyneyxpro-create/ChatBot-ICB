import { IsArray, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class EvaluateErrorDto {
  @IsString()
  @IsOptional()
  uid?: string;

  @IsString()
  @IsNotEmpty()
  tema!: string;

  @IsString()
  @IsNotEmpty()
  enunciado!: string;

  @IsArray()
  @IsString({ each: true })
  desarrollo!: string[];

  @IsInt()
  paso_error!: number;

  @IsInt()
  respuesta_usuario!: number;

  @IsString()
  @IsOptional()
  id_chat_nr?: string;
}
