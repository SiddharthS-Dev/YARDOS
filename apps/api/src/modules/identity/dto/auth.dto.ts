import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class LoginDto {
  @ApiProperty({ example: 'yard.supervisor@srijpsmartpark.example' })
  @IsEmail({}, { message: 'A valid email address is required.' })
  @MaxLength(256)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email!: string;

  @ApiProperty({ example: 'ChangeMe!Demo2025', minLength: 8 })
  @IsString()
  @IsNotEmpty({ message: 'A password is required.' })
  // Deliberately not validated against the full policy here: the policy applies
  // when SETTING a password. Rejecting a login for a weak password would tell
  // an attacker their guess was structurally wrong.
  @MaxLength(256)
  password!: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  refreshToken!: string;
}

export class LogoutDto {
  @ApiPropertyOptional({ description: 'Omit to end every session for this user.' })
  @IsString()
  @MaxLength(4096)
  refreshToken?: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  currentPassword!: string;

  @ApiProperty({ minLength: 12, description: 'Must satisfy the password policy.' })
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  newPassword!: string;
}

export class LoginResponseDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty() refreshToken!: string;
  @ApiProperty({ description: 'Access-token lifetime in seconds.' }) expiresIn!: number;
  @ApiProperty({ enum: ['Bearer'] }) tokenType!: 'Bearer';
  @ApiProperty({ type: 'object', additionalProperties: true }) user!: Record<string, unknown>;
}
