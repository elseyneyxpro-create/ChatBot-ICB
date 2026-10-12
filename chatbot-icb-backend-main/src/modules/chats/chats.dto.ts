import { Allow, IsArray, IsBoolean, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nombre!: string;
}

export class RenameChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nombre!: string;
}

export class LastVideosDto {
  @IsArray()
  videos!: { url: string; categoria: string }[];
}

export class AppendHiloDto {
  @IsString()
  input!: string;

  @IsString()
  output!: string;

  @IsString()
  @IsOptional()
  tema?: string | null;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  ejemplo_videos?: string[];
}

export class ReinforcementDto {
  @IsObject()
  reinforcement!: Record<string, any>;
}

export class UpdateEjercicioDto {
  @IsIn(['concepto', 'verdadero_falso', 'encuentra_el_error'])
  tipo!: 'concepto' | 'verdadero_falso' | 'encuentra_el_error';

  @IsBoolean()
  es_correcto!: boolean;

  @Allow()
  respuesta_alumno: any;

  @IsString()
  @IsOptional()
  feedback?: string;
}
