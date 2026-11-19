import { createECDH } from 'node:crypto';
import { plainToInstance, Transform, Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsNotEmpty, IsString, IsOptional, Matches, Max, Min, MinLength, validateSync } from 'class-validator';

export class EnvironmentVariables {
  @IsIn(['true', 'false'])
  APPROVAL_EMAIL_ENABLED: string = 'false';
  @IsOptional() @IsString() GMAIL_SMTP_USER?: string;
  @IsOptional() @IsString() GMAIL_SMTP_APP_PASSWORD?: string;
  @IsOptional() @IsString() APP_FRONTEND_ORIGIN?: string;

  @IsOptional() @IsString() WEB_PUSH_PUBLIC_KEY?: string;
  @IsOptional() @IsString() WEB_PUSH_PRIVATE_KEY?: string;
  @IsOptional() @IsString() WEB_PUSH_SUBJECT?: string;
  @IsIn(['lax', 'strict', 'none'])
  AUTH_COOKIE_SAME_SITE: 'lax' | 'strict' | 'none' = 'lax';

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
  const push = [validated.WEB_PUSH_PUBLIC_KEY, validated.WEB_PUSH_PRIVATE_KEY, validated.WEB_PUSH_SUBJECT];
  if (push.some(Boolean)) {
    try {
      if (!push.every(Boolean) || !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(validated.WEB_PUSH_SUBJECT!)) throw new Error();
      const key = createECDH('prime256v1'); key.setPrivateKey(Buffer.from(validated.WEB_PUSH_PRIVATE_KEY!, 'base64url'));
      if (key.getPublicKey().toString('base64url') !== validated.WEB_PUSH_PUBLIC_KEY) throw new Error();
    } catch { throw new Error('Invalid WEB_PUSH signing configuration: supply matching VAPID keys and a contact subject.'); }
  }
  if (validated.APPROVAL_EMAIL_ENABLED === 'true') {
    const sender = validated.GMAIL_SMTP_USER;
    const password = validated.GMAIL_SMTP_APP_PASSWORD;
    if (typeof sender !== 'string' || !/^[a-z0-9.+]+@gmail\.com$/i.test(sender)) {
      throw new Error('Approval email requires a Gmail address in GMAIL_SMTP_USER.');
    }
    if (typeof password !== 'string' || !/^[a-z]{16}$/i.test(password.replace(/\s/g, ''))) {
      throw new Error('Approval email requires a Google App Password in GMAIL_SMTP_APP_PASSWORD.');
    }
    const origin = validated.APP_FRONTEND_ORIGIN;
    if (typeof origin !== 'string' || !origin.startsWith('https://') || URL.parse(origin)?.origin !== origin) {
      throw new Error('Approval email requires the public HTTPS app origin in APP_FRONTEND_ORIGIN.');
    }
  }
  const errors = validateSync(validated, { skipMissingProperties: false });
  const origins = validated.CORS_ALLOWED_ORIGINS;
  const invalidOrigins = !Array.isArray(origins) || origins.length === 0 || origins.some((origin) => {
    if (typeof origin !== 'string' || origin.includes('*')) return true;
    try { return new URL(origin).origin !== origin; } catch { return true; }
  });
  const missingMedia = validated.MEDIA_ENABLED === 'true'
    ? ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'].filter((key) => typeof config[key] !== 'string' || !(config[key] as string).trim()) : [];
  if (validated.AUTH_COOKIE_SAME_SITE === 'none' && validated.NODE_ENV !== 'production') throw new Error('SameSite=None session cookies require production HTTPS.');
  if (errors.length > 0 || invalidOrigins || missingMedia.length > 0) {
    const fields = [...new Set([...errors.map((error) => error.property), ...missingMedia, ...(invalidOrigins ? ['CORS_ALLOWED_ORIGINS'] : [])])];
    throw new Error(`Invalid environment configuration: ${fields.join(', ')}`);
  }
  return validated;
}
