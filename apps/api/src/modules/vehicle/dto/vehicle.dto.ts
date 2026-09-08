import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { VehicleClass, VehicleStatus } from '@prisma/client';

import { PaginationQueryDto } from '@/common/dto/pagination.dto';

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1';

export class ListVehiclesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Registration number (any format), make or model.' })
  @IsOptional() @IsString() @MaxLength(64)
  search?: string;

  @ApiPropertyOptional({ enum: VehicleStatus, isArray: true })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]).filter(Boolean))
  @IsArray() @IsEnum(VehicleStatus, { each: true })
  status?: VehicleStatus[];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  siteId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  financierId?: string;

  @ApiPropertyOptional({ enum: VehicleClass })
  @IsOptional() @IsEnum(VehicleClass)
  vehicleClass?: VehicleClass;

  @ApiPropertyOptional({ description: 'Only vehicles currently at a site.' })
  @IsOptional() @Transform(toBool) @IsBoolean()
  onSiteOnly?: boolean;

  @ApiPropertyOptional({ description: 'Only vehicles with no matched financier.' })
  @IsOptional() @Transform(toBool) @IsBoolean()
  unmatchedFinancier?: boolean;
}

export class SearchQueryDto {
  @ApiPropertyOptional({ description: 'At least two characters.' })
  @IsString() @MinLength(2) @MaxLength(64)
  q!: string;
}

export class ManualVerificationDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(256)
  registeredOwnerName?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(512)
  registeredOwnerAddress?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  financierId?: string;

  @ApiPropertyOptional({ description: 'Hypothecation holder exactly as documented.' })
  @IsOptional() @IsString() @MaxLength(256)
  financierNameRaw?: string;

  @ApiPropertyOptional({
    enum: ['HYPOTHECATED', 'NOT_HYPOTHECATED', 'TERMINATED', 'UNKNOWN'],
  })
  @IsEnum({ HYPOTHECATED: 'HYPOTHECATED', NOT_HYPOTHECATED: 'NOT_HYPOTHECATED', TERMINATED: 'TERMINATED', UNKNOWN: 'UNKNOWN' })
  hypothecationStatus!: 'HYPOTHECATED' | 'NOT_HYPOTHECATED' | 'TERMINATED' | 'UNKNOWN';

  @ApiPropertyOptional({ description: 'Why manual verification was necessary. Audited.' })
  @IsString() @MinLength(5) @MaxLength(512)
  reason!: string;
}
