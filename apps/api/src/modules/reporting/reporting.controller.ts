import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsISO8601, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';

import { Permission } from '@smartpark/contracts';
import {
  AuthenticatedUser,
  CurrentUser,
  RequireAnyPermission,
} from '@/common/decorators/auth.decorators';
import {
  ActivityReport,
  AgeingReport,
  AuctionReport,
  DashboardSummary,
  OccupancyReport,
  ReportingService,
  RevenueReport,
} from './reporting.service';

class SiteScopedQueryDto {
  @IsOptional() @IsUUID()
  siteId?: string;
}

class RevenueQueryDto extends SiteScopedQueryDto {
  @IsOptional() @IsISO8601()
  from?: string;

  @IsOptional() @IsISO8601()
  to?: string;
}

class ActivityQueryDto extends SiteScopedQueryDto {
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) @Max(365)
  days?: number;
}

/**
 * Reporting endpoints.
 *
 * Every one is scoped in SQL to the caller's sites and, for a financier portal
 * user, to their own financier. A financier can see reporting about their own
 * vehicles; they cannot see Sri JP's estate-wide position (requirement S33).
 */
@ApiTags('Reporting')
@ApiBearerAuth()
@Controller({ path: 'reports', version: '1' })
export class ReportingController {
  constructor(private readonly reports: ReportingService) {}

  @Get('dashboard')
  @RequireAnyPermission(
    Permission['report:operations'],
    Permission['report:finance'],
    Permission['report:financier'],
  )
  @ApiOperation({
    summary: 'Headline operational and financial figures',
    description:
      'Every figure is derived from persisted state - none is hardcoded. Definitions are in ' +
      'docs/reporting.md.',
  })
  async dashboard(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: SiteScopedQueryDto,
  ): Promise<DashboardSummary> {
    return this.reports.dashboard(actor, query.siteId);
  }

  @Get('occupancy')
  @RequireAnyPermission(Permission['report:operations'], Permission['report:financier'])
  @ApiOperation({ summary: 'Occupancy by site and by zone' })
  async occupancy(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: SiteScopedQueryDto,
  ): Promise<OccupancyReport> {
    return this.reports.occupancy(actor, query.siteId);
  }

  @Get('ageing')
  @RequireAnyPermission(
    Permission['report:operations'],
    Permission['report:finance'],
    Permission['report:financier'],
  )
  @ApiOperation({ summary: 'Vehicle ageing distribution' })
  async ageing(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: SiteScopedQueryDto,
  ): Promise<AgeingReport> {
    return this.reports.ageing(actor, query.siteId);
  }

  @Get('revenue')
  @RequireAnyPermission(Permission['report:finance'], Permission['report:financier'])
  @ApiOperation({
    summary: 'Revenue and receivables',
    description:
      'Invoiced and collected are separate series on purpose: an invoice raised in one month ' +
      'and paid in the next belongs to both, in different months.',
  })
  async revenue(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: RevenueQueryDto,
  ): Promise<RevenueReport> {
    return this.reports.revenue(actor, {
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      siteId: query.siteId,
    });
  }

  @Get('activity')
  @RequireAnyPermission(Permission['report:operations'], Permission['report:financier'])
  @ApiOperation({
    summary: 'Daily entries and exits',
    description: 'Days with no activity are returned as zero rather than omitted.',
  })
  async activity(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ActivityQueryDto,
  ): Promise<ActivityReport> {
    return this.reports.activity(actor, { days: query.days, siteId: query.siteId });
  }

  @Get('auctions')
  @RequireAnyPermission(Permission['report:auction'], Permission['report:finance'])
  @ApiOperation({ summary: 'Auction activity and settlement value' })
  async auctions(@CurrentUser() actor: AuthenticatedUser): Promise<AuctionReport> {
    return this.reports.auctionActivity(actor);
  }
}
