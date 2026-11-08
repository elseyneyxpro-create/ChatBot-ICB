import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Abrir el tutor de un nodo, o revisar preguntas de una fase/test ya terminada (intento_ids). */
export class CrearSesionDto {
  @IsOptional() @IsInt()
  nodo_id?: number;

  /** Solo para revisar un test del mundo (sus preguntas no tienen nodo). */
  @IsOptional() @IsInt()
  mundo_id?: number;

  @IsOptional() @IsArray() @ArrayMaxSize(20)
  @Matches(/^\d{1,18}$/, { each: true })
  intento_ids?: string[];

  /** true = empezar una conversación nueva aunque exista una reciente del mismo nodo. */
  @IsOptional() @IsBoolean()
  nueva?: boolean;
}

export class MensajeTutorDto {
  @IsString() @MinLength(1) @MaxLength(3000)
  texto!: string;

  /** true = el texto es un ejercicio que trae el alumno (el tutor lo resuelve en privado y lo guía). */
  @IsOptional() @IsBoolean()
  propio?: boolean;
}

export class RetroalimentacionDto {
  @IsArray() @ArrayMaxSize(20)
  @Matches(/^\d{1,18}$/, { each: true })
  intento_ids!: string[];
}
