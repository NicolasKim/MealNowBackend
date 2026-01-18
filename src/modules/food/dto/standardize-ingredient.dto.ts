import { IsNotEmpty, IsString, IsArray, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

export class StandardizeIngredientDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  names?: string[];
}
