import { plainToInstance, Transform, Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsNotEmpty, IsString, IsOptional, Matches, Max, Min, MinLength, validateSync } from 'class-validator';

export class EnvironmentVariables {
  @Type(() => Number) @IsInt() @Min(5) @Max(300)
  MEDIA_UPLOAD_TIMEOUT_SECONDS: number = 90;

  @Type(() => Number) @IsInt() @Min(1) @Max(100)
  AUTH_LOGIN_MAX_ATTEMPTS: number = 10;

  @Type(() => Number) @IsInt() @Min(1) @Max(100)
  AUTH_REGISTER_MAX_ATTEMPTS: number = 5;

  @Type(() => Number) @IsInt() @Min(10) @Max(3600)
  AUTH_RATE_LIMIT_WINDOW_SECONDS: number = 60;

  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(300)
  MEDIA_PLAYBACK_TTL_SECONDS: number = 60;

  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(120)
  MEDIA_PLAYBACK_IDLE_TIMEOUT_SECONDS: number = 30;

  @IsIn(['true', 'false'])
  MEDIA_ENABLED: string = 'false';

  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]+$/)
  CLOUDINARY_CLOUD_NAME?: string;

  @IsOptional()
  @IsString()
  CLOUDINARY_API_KEY?: string;

  @IsOptional()
  @IsString()
  CLOUDINARY_API_SECRET?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1024)
  @Max(104857600)
  MEDIA_AUDIO_MAX_BYTES: number = 26214400;

  @Type(() => Number)
  @IsInt()
  @Min(1024)
  @Max(20971520)
  MEDIA_IMAGE_MAX_BYTES: number = 5242880;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  MEDIA_MAX_CONCURRENT_UPLOADS: number = 2;

  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(3600)
  MEDIA_CLEANUP_INTERVAL_SECONDS: number = 60;

  @Type(() => Number)
  @IsInt()
  @Min(600)
  @Max(86400)
  MEDIA_STALE_UPLOAD_SECONDS: number = 900;

  @IsString()
  @MinLength(32)
  @Matches(/\S/, { message: 'JWT_SECRET must not be blank' })
  JWT_SECRET!: string;

  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(3600)
  JWT_ACCESS_TOKEN_TTL_SECONDS: number = 900;

  @IsString()
  @IsNotEmpty()
  @Matches(/^postgres(ql)?:\/\/[^\s]+$/, { message: 'DATABASE_URL must be a PostgreSQL connection URL' })
  DATABASE_URL!: string;

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
  const missingMedia = validated.MEDIA_ENABLED === 'true'
    ? ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'].filter((key) => typeof config[key] !== 'string' || !(config[key] as string).trim()) : [];
  if (errors.length > 0 || invalidOrigins || missingMedia.length > 0) {
    const fields = [...new Set([...errors.map((error) => error.property), ...missingMedia, ...(invalidOrigins ? ['CORS_ALLOWED_ORIGINS'] : [])])];
    throw new Error(`Invalid environment configuration: ${fields.join(', ')}`);
  }
  return validated;
}
