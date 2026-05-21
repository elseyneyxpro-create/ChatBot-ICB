import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SaveExerciseResultDto {
  @IsString()
  @IsNotEmpty()
  uid!: string;

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
