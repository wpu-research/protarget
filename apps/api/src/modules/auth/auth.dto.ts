import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength, MinLength, ValidateBy } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export const NormalizeEmail = () => Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value);
// bcrypt's 72-byte limit must not silently truncate UTF-8 passwords.
export const PasswordBytes = () => ValidateBy({
  name: 'passwordBytes',
  validator: { validate: (value: unknown) => typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 72,
    defaultMessage: () => 'password must not exceed 72 UTF-8 bytes' },
});

export class LoginDto {
  @ApiProperty() @NormalizeEmail() @IsEmail() @MaxLength(254)
  email: string;

  @ApiProperty({ format: 'password' }) @IsString() @MinLength(1) @PasswordBytes()
  password: string;
}

export class AcceptInviteDto {
  @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/)
  token: string;

  @ApiProperty({ format: 'password', minLength: 12, maxLength: 72 })
  @IsString() @MinLength(12) @PasswordBytes()
  password: string;
}
