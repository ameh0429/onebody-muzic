import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'grace@example.org', format: 'email', maxLength: 254 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'A-long-example-passphrase!', writeOnly: true, format: 'password' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
