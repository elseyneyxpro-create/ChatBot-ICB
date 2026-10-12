import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsString, ValidateNested } from 'class-validator';

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

export class RespuestaEntrenarDto {
  @IsString()
  respuesta!: string;
}
