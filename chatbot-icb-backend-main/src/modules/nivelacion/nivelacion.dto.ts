import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsString, ValidateNested, IsBoolean, Matches, MaxLength } from 'class-validator';

export const NIVELES = ['Principiante', 'Intermedio', 'Avanzado'] as const;
export type Nivel = (typeof NIVELES)[number];

export class RespuestaDto {
  @IsInt()
  pregunta_id!: number;

  @IsString()
  respuesta!: string;
}

export class RespuestasDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RespuestaDto)
  respuestas!: RespuestaDto[];
}

/** Respuesta a UNA pregunta de la fase de un nodo (cola estilo Duolingo). */
export class RespuestaFaseDto {
  @Matches(/^[a-f0-9]{24}$/)
  sesion_id!: string;

  @IsInt()
  pregunta_id!: number;

  @IsString() @MaxLength(2000)
  respuesta!: string;
}

export class RespuestaEntrenarDto {
  @IsString()
  respuesta!: string;
}

/** Modo dev (solo equipo): ver la nivelación con todos los mundos y nodos desbloqueados. */
export class ModoDevDto {
  @IsBoolean()
  desbloquear!: boolean;
}
