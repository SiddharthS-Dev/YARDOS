import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApprovalDecision, ReleaseRequestStatus } from '@prisma/client';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

import { BillingPartyType, Paginated, Permission } from '@smartpark/contracts';
import { ApiErrorDto } from '@/common/dto/api-error.dto';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import {
  AuthenticatedUser,
  CurrentUser,
  RequirePermissions,
} from '@/common/decorators/auth.decorators';
import {
  EligibilitySnapshot,
  ReleaseDetail,
  ReleaseListItem,
  ReleaseService,
} from './release.service';

class ListReleasesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ReleaseRequestStatus, isArray: true })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]).filter(Boolean))
  @IsArray() @IsEnum(ReleaseRequestStatus, { each: true })
  status?: ReleaseRequestStatus[];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  siteId?: string;

  @ApiPropertyOptional({ description: 'Release number or registration number.' })
  @IsOptional() @IsString() @MaxLength(64)
  search?: string;
}

class RequestReleaseDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'The stay to release.' })
  @IsUUID()
  sessionId!: string;

  @ApiPropertyOptional({ description: 'Why the vehicle is being released. Audited.' })
  @IsString() @MinLength(5) @MaxLength(512)
  reason!: string;

  @ApiPropertyOptional({
    enum: ['FINANCIER', 'CUSTOMER', 'OTHER'],
    description: 'Who is collecting the vehicle.',
  })
  @IsEnum({ FINANCIER: 'FINANCIER', CUSTOMER: 'CUSTOMER', OTHER: 'OTHER' })
  requestedForPartyType!: 'FINANCIER' | 'CUSTOMER' | 'OTHER';

  @ApiPropertyOptional({ description: 'Required when the collecting party is a customer.' })
  @IsOptional() @IsString() @MaxLength(256)
  requestedForName?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(32)
  requestedForPhone?: string;

  @ApiPropertyOptional({ description: 'Identity document reference sighted at handover.' })
  @IsOptional() @IsString() @MaxLength(128)
  requestedForIdRef?: string;
}

class DecideReleaseDto {
  @ApiPropertyOptional({ enum: ApprovalDecision })
  @IsEnum(ApprovalDecision)
  decision!: ApprovalDecision;

  @ApiPropertyOptional({ description: 'Recorded on the append-only approval log.' })
  @IsString() @MinLength(3) @MaxLength(512)
  remarks!: string;
}

class CompleteReleaseDto {
  @ApiPropertyOptional({ description: 'The one-time gate code issued at approval.' })
  @IsOptional() @IsString() @MaxLength(16)
  authorizationCode?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'The exit capture, when ANPR recorded one.' })
  @IsOptional() @IsUUID()
  exitAnprEventId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  exitGateId?: string;

  @ApiPropertyOptional({ description: 'Actual exit time. Defaults to now.' })
  @IsOptional() @IsISO8601()
  exitAt?: string;
}

class CancelReleaseDto {
  @ApiPropertyOptional()
  @IsString() @MinLength(3) @MaxLength(512)
  reason!: string;
}

@ApiTags('Releases')
@ApiBearerAuth()
@Controller({ path: 'releases', version: '1' })
export class ReleaseController {
  constructor(private readonly releases: ReleaseService) {}

  @Get()
  @RequirePermissions(Permission['release:read'])
  @ApiOperation({ summary: 'List release requests' })
  async list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListReleasesQueryDto,
  ): Promise<Paginated<ReleaseListItem>> {
    return this.releases.list(actor, query, {
      status: query.status,
      siteId: query.siteId,
      search: query.search,
    });
  }

  @Get('eligibility/:sessionId')
  @RequirePermissions(Permission['release:read'])
  @ApiOperation({
    summary: 'Check whether a vehicle may be released',
    description:
      'Read-only. Returns every check with its outcome so an operator can see the blockers ' +
      'before committing to a request. Blocking failures prevent release; advisory ones do not.',
  })
  async eligibility(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<EligibilitySnapshot> {
    return this.releases.checkEligibility(actor, sessionId);
  }

  @Get(':id')
  @RequirePermissions(Permission['release:read'])
  @ApiOperation({ summary: 'One release request, with its approval history' })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async findOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReleaseDetail> {
    return this.releases.findById(actor, id);
  }

  @Post()
  @RequirePermissions(Permission['release:request'])
  @ApiOperation({
    summary: 'Request a vehicle release',
    description:
      'Runs eligibility, computes the estimated final charge, and routes to approval or ' +
      'settlement. An ineligible request is recorded as ELIGIBILITY_FAILED with its blockers ' +
      'rather than being rejected outright, so it can be resubmitted once cleared.',
  })
  @ApiResponse({ status: 409, description: 'A release is already in progress.', type: ApiErrorDto })
  async request(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: RequestReleaseDto,
  ): Promise<ReleaseDetail> {
    return this.releases.requestRelease(actor, {
      sessionId: dto.sessionId,
      reason: dto.reason,
      requestedForPartyType: dto.requestedForPartyType as BillingPartyType,
      requestedForName: dto.requestedForName ?? null,
      requestedForPhone: dto.requestedForPhone ?? null,
      requestedForIdRef: dto.requestedForIdRef ?? null,
    });
  }

  @Post(':id/decision')
  @RequirePermissions(Permission['release:approve'])
  @ApiOperation({
    summary: 'Approve or reject a release',
    description:
      'Segregation of duty is enforced: you cannot approve a release you requested. On ' +
      'approval a one-time gate authorisation code is returned EXACTLY ONCE - only its hash ' +
      'is stored, so it cannot be recovered afterwards.',
  })
  @ApiResponse({ status: 403, description: 'Self-approval attempted.', type: ApiErrorDto })
  @ApiResponse({ status: 409, description: 'Outstanding balance blocks approval.', type: ApiErrorDto })
  async decide(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideReleaseDto,
  ): Promise<{ release: ReleaseDetail; authorizationCode: string | null }> {
    return this.releases.decide(actor, id, dto.decision, dto.remarks);
  }

  @Post(':id/complete')
  @RequirePermissions(Permission['release:execute'])
  @ApiOperation({
    summary: 'Record the physical exit and close the visit',
    description:
      'Freezes the FINAL charge to the actual exit instant, raises the invoice from it, closes ' +
      'the stay, frees the bay and marks the vehicle EXITED. Idempotent: a retry returns the ' +
      'original invoice rather than raising a second one.',
  })
  @ApiResponse({ status: 409, description: 'Not approved, or already completed.', type: ApiErrorDto })
  async complete(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteReleaseDto,
  ): Promise<{ release: ReleaseDetail; invoiceId: string | null; invoiceNumber: string | null }> {
    return this.releases.completeRelease(actor, id, {
      authorizationCode: dto.authorizationCode ?? null,
      exitAnprEventId: dto.exitAnprEventId ?? null,
      exitGateId: dto.exitGateId ?? null,
      exitAt: dto.exitAt ? new Date(dto.exitAt) : undefined,
    });
  }

  @Post(':id/cancel')
  @RequirePermissions(Permission['release:request'])
  @ApiOperation({ summary: 'Cancel a release request' })
  async cancel(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelReleaseDto,
  ): Promise<ReleaseDetail> {
    return this.releases.cancel(actor, id, dto.reason);
  }
}
