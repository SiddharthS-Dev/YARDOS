import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ParkingSessionStatus } from '@prisma/client';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { ChargeBreakdown, Paginated, Permission } from '@smartpark/contracts';
import { ApiErrorDto } from '@/common/dto/api-error.dto';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import {
  AuthenticatedUser,
  CurrentUser,
  RequirePermissions,
} from '@/common/decorators/auth.decorators';
import { ChargeService } from '@/modules/billing/charge.service';
import {
  ParkingSessionService,
  SessionDetail,
  SessionListItem,
} from './parking-session.service';

class ListSessionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  siteId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  financierId?: string;

  @ApiPropertyOptional({ enum: ParkingSessionStatus, isArray: true })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]).filter(Boolean))
  @IsArray() @IsEnum(ParkingSessionStatus, { each: true })
  status?: ParkingSessionStatus[];

  @ApiPropertyOptional({ description: 'Stay number or registration number.' })
  @IsOptional() @IsString() @MaxLength(64)
  search?: string;

  @ApiPropertyOptional({ description: 'Only stays with no rate plan attached.' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  rateUnresolvedOnly?: boolean;

  @ApiPropertyOptional({ description: 'Only stays longer than this many days.' })
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(0)
  minAgeingDays?: number;
}

class ReasonDto {
  @ApiPropertyOptional({ description: 'Recorded in the audit trail.' })
  @IsString() @MinLength(3) @MaxLength(512)
  reason!: string;
}

@ApiTags('Parking')
@ApiBearerAuth()
@Controller({ path: 'parking-sessions', version: '1' })
export class ParkingController {
  constructor(
    private readonly sessions: ParkingSessionService,
    private readonly charges: ChargeService,
  ) {}

  @Get()
  @RequirePermissions(Permission['session:read'])
  @ApiOperation({
    summary: 'List parking stays',
    description:
      'Scoped to the caller\'s sites, and to their own financier for portal users.',
  })
  async list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListSessionsQueryDto,
  ): Promise<Paginated<SessionListItem>> {
    return this.sessions.list(actor, query, {
      siteId: query.siteId,
      financierId: query.financierId,
      status: query.status,
      search: query.search,
      rateUnresolvedOnly: query.rateUnresolvedOnly,
      minAgeingDays: query.minAgeingDays,
    });
  }

  @Get(':id')
  @RequirePermissions(Permission['session:read'])
  @ApiOperation({
    summary: 'One stay, with its live charge',
    description: 'The charge shown is an estimate as at now, not a committed amount.',
  })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async findOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SessionDetail> {
    return this.sessions.findById(actor, id);
  }

  @Get(':id/charge')
  @RequirePermissions(Permission['charge:read'])
  @ApiOperation({
    summary: 'Explainable charge breakdown',
    description:
      'Every line records the slab it came from, the ladder positions it covered, the units ' +
      'consumed and the rate applied, plus a narrative. Requirement S14: never just a number.',
  })
  async charge(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ breakdown: ChargeBreakdown | null; unavailableReason?: string }> {
    await this.sessions.findById(actor, id);
    const result = await this.charges.estimate(id);
    return {
      breakdown: result.breakdown,
      ...(result.unavailableReason ? { unavailableReason: result.unavailableReason } : {}),
    };
  }

  @Get(':id/charge-history')
  @RequirePermissions(Permission['charge:read'])
  @ApiOperation({
    summary: 'Every calculation ever made for this stay',
    description: 'The audit view: what was charged, when, and against which rate plan.',
  })
  async chargeHistory(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.sessions.findById(actor, id);
    const rows = await this.charges.history(id);
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      asOf: row.asOf.toISOString(),
      engineVersion: row.engineVersion,
      subtotal: row.subtotal.toFixed(4),
      taxTotal: row.taxTotal.toFixed(4),
      total: row.total.toFixed(4),
      currency: row.currency,
      chargeableUnits: row.chargeableUnits.toFixed(6),
      inputsHash: row.inputsHash,
      isCurrent: row.isCurrent,
      createdAt: row.createdAt.toISOString(),
      explanation: row.explanation as string[],
      lines: row.lines.map((line) => ({
        lineNo: line.lineNo,
        kind: line.kind,
        description: line.description,
        units: line.units.toFixed(6),
        unitAmount: line.unitAmount.toFixed(4),
        amount: line.amount.toFixed(4),
      })),
    }));
  }

  @Post(':id/hold')
  @RequirePermissions(Permission['session:hold'])
  @ApiOperation({
    summary: 'Place a hold',
    description:
      'Blocks release without ending the stay. Charges keep accruing, because the vehicle is ' +
      'still occupying a bay.',
  })
  async hold(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ): Promise<SessionListItem> {
    return this.sessions.placeHold(actor, id, dto.reason);
  }

  @Post(':id/lift-hold')
  @RequirePermissions(Permission['session:hold'])
  @ApiOperation({ summary: 'Lift a hold' })
  async liftHold(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ): Promise<SessionListItem> {
    return this.sessions.liftHold(actor, id, dto.reason);
  }

  @Post(':id/attach-rate')
  @RequirePermissions(Permission['charge:recalculate'])
  @ApiOperation({
    summary: 'Attach a rate plan to an unrated stay',
    description:
      'The finance work-queue action for the gap the gate deliberately leaves: a vehicle is ' +
      'admitted even when no contract rate could be resolved, so the barrier never blocks.',
  })
  @ApiResponse({ status: 409, description: 'Still no applicable rate plan.', type: ApiErrorDto })
  async attachRate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    await this.sessions.findById(actor, id);
    const result = await this.charges.attachRatePlan(id, actor.id, dto.reason);
    return {
      calculationId: result.calculationId,
      breakdown: result.breakdown,
    };
  }
}
