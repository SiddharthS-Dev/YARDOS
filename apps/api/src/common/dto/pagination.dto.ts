import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, Paginated } from '@smartpark/contracts';

/**
 * Query parameters shared by every collection endpoint.
 *
 * `pageSize` is hard-capped (requirement S57: never let a client pull the whole
 * table into a browser). Sorting is validated against an allow-list by each
 * controller, because an arbitrary `sortBy` reaching the database is both an
 * injection surface and a way to force an unindexed sort.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = DEFAULT_PAGE_SIZE;

  @ApiPropertyOptional({ description: 'Field to sort by. Validated per endpoint.' })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir: 'asc' | 'desc' = 'desc';

  get skip(): number {
    return (this.page - 1) * this.pageSize;
  }

  get take(): number {
    return this.pageSize;
  }

  /**
   * Resolves the sort column against an allow-list.
   * Falls back to the default rather than rejecting, so a stale bookmark from
   * an older console build does not 400.
   */
  orderBy<T extends string>(allowed: readonly T[], fallback: T): Record<string, 'asc' | 'desc'> {
    const field = (allowed as readonly string[]).includes(this.sortBy ?? '')
      ? (this.sortBy as string)
      : fallback;
    return { [field]: this.sortDir };
  }
}

/** Builds the standard collection envelope. */
export function paginate<T>(
  items: T[],
  totalItems: number,
  query: { page: number; pageSize: number },
): Paginated<T> {
  const totalPages = query.pageSize > 0 ? Math.ceil(totalItems / query.pageSize) : 0;
  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    totalItems,
    totalPages,
    hasNext: query.page < totalPages,
    hasPrevious: query.page > 1,
  };
}

/** Swagger helper: documents a paginated response of a given item schema. */
export class PaginatedResponseDto<T> {
  @ApiProperty({ isArray: true })
  items!: T[];

  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() totalItems!: number;
  @ApiProperty() totalPages!: number;
  @ApiProperty() hasNext!: boolean;
  @ApiProperty() hasPrevious!: boolean;
}
