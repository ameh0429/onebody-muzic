import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength, MinLength, Validate } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PasswordsMatch } from '../validators/passwords-match.validator';

export class RegisterDto {
  @ApiProperty({ example: 'Grace James', minLength: 2, maxLength: 200 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 'grace@example.org', format: 'email', maxLength: 254 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'A-long-example-passphrase!', minLength: 12, maxLength: 128, writeOnly: true, format: 'password' })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @Matches(/\S/, { message: 'password must contain a non-whitespace character' })
  password!: string;

  @ApiProperty({ example: 'A-long-example-passphrase!', writeOnly: true, format: 'password' })
  @IsString()
  @MaxLength(128)
  @Validate(PasswordsMatch)
  confirmPassword!: string;
}
