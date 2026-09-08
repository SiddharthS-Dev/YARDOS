import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { TravelDirection, VehicleClass } from '@prisma/client';

/**
 * Note: the ingest endpoint deliberately does NOT validate the capture payload
 * with a DTO. Every camera vendor sends something different, and parsing is the
 * provider adapter's job - rejecting an unknown-but-valid vendor field at the
 * validation pipe would push vendor knowledge into the wrong layer.
 */
export class SimulateCaptureDto {
  @ApiProperty({ description: 'Device code as configured at the site, e.g. "CAM-G1-IN".' })
  @IsString() @MinLength(1) @MaxLength(64)
  deviceCode!: string;

  @ApiProperty({ example: 'TN01AB1234' })
  @IsString() @MinLength(4) @MaxLength(32)
  plateNumber!: string;

  @ApiPropertyOptional({ enum: TravelDirection })
  @IsOptional() @IsEnum(TravelDirection)
  direction?: TravelDirection;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 1,
    default: 0.96,
    description: 'Set below the device threshold to exercise the manual review queue.',
  })
  @IsOptional() @IsNumber() @Min(0) @Max(1)
  confidence?: number;

  @ApiPropertyOptional({ enum: VehicleClass })
  @IsOptional() @IsEnum(VehicleClass)
  vehicleClassHint?: VehicleClass;
}

export class ResolveReviewDto {
  @ApiProperty({ description: 'The plate as the operator reads it from the image.' })
  @IsString() @MinLength(4) @MaxLength(32)
  correctedPlate!: string;

  @ApiProperty({ description: 'Why the override was needed. Recorded in the audit trail.' })
  @IsString() @MinLength(3) @MaxLength(512)
  notes!: string;

  @ApiPropertyOptional({ description: 'Reject the capture instead of admitting it.' })
  @IsOptional() @IsBoolean()
  reject?: boolean;
}
