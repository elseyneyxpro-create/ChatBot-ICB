import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

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

/**
 * Respuesta del alumno al tutor. No hay texto libre: elige una de las alternativas del último mensaje
 * del tutor (opcion = posición, desde 0) o toca un botón de ayuda.
 */
export class MensajeTutorDto {
  @IsOptional() @IsInt() @Min(0) @Max(3)
  opcion?: number;

  @IsOptional() @IsIn(['no_entiendo', 'pista'])
  ayuda?: 'no_entiendo' | 'pista';
}

export class RetroalimentacionDto {
  @IsArray() @ArrayMaxSize(20)
  @Matches(/^\d{1,18}$/, { each: true })
  intento_ids!: string[];
}
