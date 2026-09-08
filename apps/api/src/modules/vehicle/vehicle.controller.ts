import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { HypothecationStatus } from '@prisma/client';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Paginated, Permission } from '@smartpark/contracts';
import { ApiErrorDto } from '@/common/dto/api-error.dto';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import {
  AuthenticatedUser,
  CurrentUser,
  RequirePermissions,
} from '@/common/decorators/auth.decorators';
import { VehicleRegistryService } from '@/modules/registry/vehicle-registry.service';
import {
  ListVehiclesQueryDto,
  ManualVerificationDto,
  SearchQueryDto,
} from './dto/vehicle.dto';
import { TimelineItem, VehicleDetail, VehicleListItem, VehicleService } from './vehicle.service';

@ApiTags('Vehicles')
@ApiBearerAuth()
@Controller({ path: 'vehicles', version: '1' })
export class VehicleController {
  constructor(
    private readonly vehicles: VehicleService,
    private readonly registry: VehicleRegistryService,
  ) {}

  @Get()
  @RequirePermissions(Permission['vehicle:read'])
  @ApiOperation({
    summary: 'Search the central vehicle repository',
    description:
      'Registration numbers are normalised, so "TN 01 AB 1234", "TN-01-AB-1234" and ' +
      '"tn01ab1234" all match the same vehicle. Financier portal users see only their own ' +
      'financed vehicles; owner names are masked unless the caller holds vehicle:pii:read.',
  })
  async list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListVehiclesQueryDto,
  ): Promise<Paginated<VehicleListItem>> {
    return this.vehicles.list(actor, query, {
      search: query.search,
      status: query.status,
      siteId: query.siteId,
      financierId: query.financierId,
      vehicleClass: query.vehicleClass,
      onSiteOnly: query.onSiteOnly,
      unmatchedFinancier: query.unmatchedFinancier,
    });
  }

  @Get('search')
  @RequirePermissions(Permission['vehicle:read'])
  @ApiOperation({ summary: 'Type-ahead search for the global search bar' })
  async search(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: SearchQueryDto,
  ): Promise<VehicleListItem[]> {
    return this.vehicles.search(actor, query.q);
  }

  @Get(':id')
  @RequirePermissions(Permission['vehicle:read'])
  @ApiOperation({ summary: 'Full vehicle record, including ownership and the active stay' })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async findOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VehicleDetail> {
    return this.vehicles.findById(actor, id);
  }

  @Get(':id/timeline')
  @RequirePermissions(Permission['vehicle:timeline:read'])
  @ApiOperation({
    summary: 'Immutable location and event history',
    description:
      'Built from persisted append-only events, not from current-state columns, so history ' +
      'survives later status changes.',
  })
  async timeline(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<TimelineItem>> {
    return this.vehicles.timeline(actor, id, query);
  }

  @Post(':id/registry-lookup')
  @RequirePermissions(Permission['registry:lookup'])
  @ApiOperation({
    summary: 'Queue a vehicle registry enrichment',
    description:
      'Asynchronous by design. Returns immediately; the record is enriched by a worker. ' +
      'Skipped when existing data is still inside the freshness window, because aggregator ' +
      'calls are charged per request.',
  })
  async requestLookup(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ lookupId: string | null; skipped: boolean; reason?: string; provider: string; authoritative: boolean }> {
    const vehicle = await this.vehicles.findById(actor, id);
    const result = await this.registry.requestEnrichment({
      vehicleId: id,
      organizationId: actor.organizationId,
      normalizedRegistrationNumber: vehicle.normalizedRegistrationNumber,
      triggeredBy: 'MANUAL',
      requestedById: actor.id,
      force: true,
    });
    return {
      ...result,
      provider: this.registry.providerName,
      authoritative: this.registry.isAuthoritative,
    };
  }

  @Post(':id/manual-verification')
  @RequirePermissions(Permission['registry:verify:manual'])
  @ApiOperation({
    summary: 'Record ownership verified by hand',
    description:
      'The escape hatch for when the registry has no record or is unavailable. Recorded as ' +
      'MANUALLY_VERIFIED - never indistinguishable from registry-sourced data - and audited.',
  })
  async manualVerification(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ManualVerificationDto,
  ): Promise<{ ok: true }> {
    await this.vehicles.findById(actor, id);
    await this.registry.recordManualVerification({
      vehicleId: id,
      organizationId: actor.organizationId,
      actorId: actor.id,
      registeredOwnerName: dto.registeredOwnerName ?? null,
      registeredOwnerAddress: dto.registeredOwnerAddress ?? null,
      financierId: dto.financierId ?? null,
      financierNameRaw: dto.financierNameRaw ?? null,
      hypothecationStatus: dto.hypothecationStatus as HypothecationStatus,
      reason: dto.reason,
    });
    return { ok: true };
  }
}
