import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SaveExerciseResultDto {
  /** Lo sobrescribe el backend con el uid del JWT. */
  @IsString()
  @IsOptional()
  uid?: string;

  @IsString()
  @IsNotEmpty()
  tema!: string;

  @IsString()
  @IsNotEmpty()
  tipo!: string;

  @IsBoolean()
  es_correcto!: boolean;

  @IsString()
  @IsOptional()
  enunciado?: string;

  @IsString()
  @IsOptional()
  id_chat_nr?: string;
}
