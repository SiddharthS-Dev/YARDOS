import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Documents the single error shape returned by every non-2xx response. */
export class ApiErrorDto {
  @ApiProperty({
    example: 'VEHICLE_ALREADY_ACTIVE',
    description: 'Stable machine-readable code. Safe to branch on.',
  })
  code!: string;

  @ApiProperty({
    example: 'This vehicle already has an active parking session.',
    description: 'Human-readable message. May change; never parse it.',
  })
  message!: string;

  @ApiProperty({ description: 'Quote this when reporting a problem.' })
  correlationId!: string;

  @ApiProperty({ format: 'date-time' })
  timestamp!: string;

  @ApiPropertyOptional()
  path?: string;

  @ApiPropertyOptional({
    description: 'Code-specific context. Never contains internals or credentials.',
    type: 'object',
    additionalProperties: true,
  })
  details?: Record<string, unknown>;
}
