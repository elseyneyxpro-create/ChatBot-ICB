/* eslint-disable @typescript-eslint/no-unsafe-call */
import { IsOptional, IsString, IsNumber } from 'class-validator';

export class AskDto {
  @IsString()
  @IsOptional()
  question?: string;

  @IsString()
  @IsOptional()
  uid?: string;

  @IsString()
  @IsOptional()
  id_chat_nr?: string;

  @IsNumber()
  @IsOptional()
  total_hilos?: number;

  @IsString()
  @IsOptional()
  image_base64?: string;

  @IsString()
  @IsOptional()
  last_tema?: string;
}
