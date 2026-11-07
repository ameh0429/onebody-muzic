import { plainToInstance, Transform, Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsNotEmpty, IsString, Matches, Max, Min, validateSync } from 'class-validator';

export class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: string = 'development';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').map((origin) => origin.trim()) : value,
  )
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @Matches(/^https?:\/\/[^\s/?#@]+$/, {
    each: true,
    message: 'CORS_ALLOWED_ORIGINS must contain explicit HTTP(S) origins without paths or wildcards',
  })
  CORS_ALLOWED_ORIGINS!: string[];
}

export function validateEnvironment(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config);
  const errors = validateSync(validated, { skipMissingProperties: false });
  const origins = validated.CORS_ALLOWED_ORIGINS;
  const invalidOrigins = !Array.isArray(origins) || origins.length === 0 || origins.some((origin) => {
    if (typeof origin !== 'string' || origin.includes('*')) return true;
    try { return new URL(origin).origin !== origin; } catch { return true; }
  });
  if (errors.length > 0 || invalidOrigins) {
    const fields = [...new Set([...errors.map((error) => error.property), ...(invalidOrigins ? ['CORS_ALLOWED_ORIGINS'] : [])])];
    throw new Error(`Invalid environment configuration: ${fields.join(', ')}`);
  }
  return validated;
}
