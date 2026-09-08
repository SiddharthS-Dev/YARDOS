import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserStatus } from '@prisma/client';

import { PaginationQueryDto } from '@/common/dto/pagination.dto';

export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Matches name or email.' })
  @IsOptional() @IsString() @MaxLength(128)
  search?: string;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional() @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({ example: 'YARD_STAFF' })
  @IsOptional() @IsString() @MaxLength(64)
  roleCode?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  financierId?: string;
}

export class CreateUserDto {
  @ApiProperty()
  @IsEmail() @MaxLength(256)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email!: string;

  @ApiProperty()
  @IsString() @MinLength(2) @MaxLength(160)
  fullName!: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(32)
  phone?: string;

  @ApiProperty({ type: [String], example: ['YARD_STAFF'] })
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) @Type(() => String)
  roleCodes!: string[];

  @ApiPropertyOptional({ type: [String], format: 'uuid', description: 'Sites this user may access.' })
  @IsOptional() @IsArray() @IsUUID('4', { each: true })
  siteIds?: string[];

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Required for, and only permitted on, financier portal users.',
  })
  @IsOptional() @IsUUID()
  financierId?: string;

  @ApiPropertyOptional({
    description: 'Omit to have a temporary password generated and returned once.',
  })
  @IsOptional() @IsString() @MinLength(8) @MaxLength(256)
  password?: string;
}

export class SetRolesDto {
  @ApiProperty({ type: [String] })
  @IsArray() @ArrayNotEmpty() @IsString({ each: true })
  roleCodes!: string[];
}

export class SetSiteAccessDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray() @IsUUID('4', { each: true })
  siteIds!: string[];
}

export class SetUserStatusDto {
  @ApiProperty({ enum: UserStatus })
  @IsEnum(UserStatus)
  status!: UserStatus;

  @ApiProperty({ description: 'Recorded in the audit trail.' })
  @IsString() @MinLength(3) @MaxLength(512)
  reason!: string;
}
