import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

/** Abrir el tutor sobre preguntas respondidas mal en una fase/test ya terminada (intento_ids, obligatorio). */
export class CrearSesionDto {
  @IsOptional() @IsInt()
  nodo_id?: number;

  /** Solo para revisar un test del mundo (sus preguntas no tienen nodo). */
  @IsOptional() @IsInt()
  mundo_id?: number;

  @IsOptional() @IsArray() @ArrayMaxSize(20)
  @Matches(/^\d{1,18}$/, { each: true })
  intento_ids?: string[];
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
