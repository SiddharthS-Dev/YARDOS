import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { AnprEventStatus, TravelDirection } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import {
  ErrorCode,
  HEADER_ANPR_SIGNATURE,
  HEADER_ANPR_TIMESTAMP,
  Permission,
} from '@smartpark/contracts';
import { AppException } from '@/common/errors/app-exception';
import { ApiErrorDto } from '@/common/dto/api-error.dto';
import { PaginationQueryDto, paginate } from '@/common/dto/pagination.dto';
import {
  AllowServiceAccount,
  AuthenticatedUser,
  CurrentUser,
  RequirePermissions,
} from '@/common/decorators/auth.decorators';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { AccessScope } from '@/modules/identity/guards';
import { AnprIngestionService, IngestResult } from './anpr-ingestion.service';
import { MockAnprProvider } from './providers/mock-anpr.provider';
import { ResolveReviewDto, SimulateCaptureDto } from './dto/anpr.dto';

@ApiTags('ANPR')
@ApiBearerAuth()
@Controller({ path: 'anpr', version: '1' })
export class AnprController {
  constructor(
    private readonly ingestion: AnprIngestionService,
    private readonly mockProvider: MockAnprProvider,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * The camera ingest endpoint.
   *
   * Called by ANPR gateways under a device service account holding only
   * `anpr:event:ingest`. That account can post captures and nothing else, so a
   * leaked camera credential cannot be used to enumerate the yard.
   */
  @Post('events')
  @AllowServiceAccount()
  @RequirePermissions(Permission['anpr:event:ingest'])
  @Throttle({ anpr: { limit: 600, ttl: 60_000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Ingest a plate capture',
    description:
      'Idempotent on the provider event id, and de-duplicated on a windowed hash of ' +
      '(device, plate, direction) so one physical arrival producing many frames yields one ' +
      'stay. Captures below the confidence threshold go to the review queue rather than ' +
      'opening a barrier.',
  })
  @ApiBody({
    description: 'Vendor-specific capture payload, normalised by the configured adapter.',
    schema: {
      type: 'object',
      example: {
        eventId: 'evt-8837211',
        deviceId: 'CAM-G1-IN',
        plateNumber: 'TN01AB1234',
        confidence: 0.97,
        direction: 'ENTRY',
        capturedAt: '2025-09-08T04:12:55.000Z',
      },
    },
  })
  @ApiResponse({ status: 202, description: 'Capture accepted.' })
  @ApiResponse({ status: 401, description: 'Signature invalid.', type: ApiErrorDto })
  @ApiResponse({ status: 404, description: 'Unknown device.', type: ApiErrorDto })
  async ingest(
    @Body() payload: Record<string, unknown>,
    @Headers(HEADER_ANPR_SIGNATURE) signature?: string,
    @Headers(HEADER_ANPR_TIMESTAMP) timestamp?: string,
  ): Promise<IngestResult> {
    return this.ingestion.ingest({
      payload,
      rawBody: JSON.stringify(payload ?? {}),
      signature,
      timestamp,
    });
  }

  @Post('simulate')
  @RequirePermissions(Permission['anpr:event:review'])
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Simulate a capture (non-production only)',
    description:
      'Drives the full gate workflow without camera hardware. Refused unless the ANPR ' +
      'simulator is the configured provider, so it can never fabricate a capture against ' +
      'live operations.',
  })
  @ApiResponse({ status: 409, description: 'Not available for the live provider.', type: ApiErrorDto })
  async simulate(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: SimulateCaptureDto,
  ): Promise<IngestResult> {
    if (this.ingestion.providerName !== 'mock') {
      throw new AppException(
        ErrorCode.CONFLICT,
        'Capture simulation is only available while the ANPR simulator is configured.',
        { details: { activeProvider: this.ingestion.providerName } },
      );
    }

    const device = await this.prisma.anprDevice.findFirst({
      where: { code: dto.deviceCode, site: { organizationId: actor.organizationId } },
    });
    if (!device) {
      throw new AppException(
        ErrorCode.ANPR_DEVICE_UNKNOWN,
        `No ANPR device with code "${dto.deviceCode}".`,
      );
    }
    AccessScope.assertSite(actor, device.siteId);

    const event = this.mockProvider.simulate({
      providerDeviceId: device.providerDeviceId,
      plateNumber: dto.plateNumber,
      direction: (dto.direction ?? device.direction) as TravelDirection,
      confidence: dto.confidence,
      vehicleClassHint: dto.vehicleClassHint ?? null,
    });

    return this.ingestion.ingest({
      payload: {
        eventId: event.providerEventId,
        deviceId: event.providerDeviceId,
        plateNumber: event.plateNumberRaw,
        confidence: event.confidence,
        direction: event.direction,
        capturedAt: event.capturedAt.toISOString(),
        vehicleType: event.vehicleClassHint,
        simulator: true,
      },
      rawBody: '',
    });
  }

  @Get('events')
  @RequirePermissions(Permission['anpr:event:read'])
  @ApiOperation({ summary: 'Recent capture events' })
  async listEvents(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
    @Query('status') status?: AnprEventStatus,
    @Query('siteId') siteId?: string,
  ) {
    const siteFilter = AccessScope.siteFilter(actor);
    const where = {
      organizationId: actor.organizationId,
      ...(status ? { status } : {}),
      ...(siteId ? { siteId } : siteFilter ? { siteId: siteFilter } : {}),
    };

    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.anprEvent.findMany({
        where,
        orderBy: { capturedAt: 'desc' },
        skip: query.skip,
        take: query.take,
        include: {
          device: { select: { code: true, name: true } },
          site: { select: { name: true, code: true } },
          gate: { select: { code: true, name: true } },
          vehicle: { select: { id: true, registrationNumber: true, make: true, model: true } },
        },
      }),
      this.prisma.anprEvent.count({ where }),
    ]);

    return paginate(
      rows.map((row) => ({
        id: row.id,
        capturedAt: row.capturedAt.toISOString(),
        receivedAt: row.receivedAt.toISOString(),
        plateNumberRaw: row.plateNumberRaw,
        normalizedPlate: row.normalizedPlate,
        correctedPlate: row.correctedPlate,
        confidence: row.confidence.toFixed(4),
        direction: row.direction,
        status: row.status,
        deviceCode: row.device.code,
        deviceName: row.device.name,
        siteName: row.site.name,
        gateCode: row.gate?.code ?? null,
        vehicleId: row.vehicle?.id ?? null,
        vehicleDescription: row.vehicle
          ? [row.vehicle.make, row.vehicle.model].filter(Boolean).join(' ') || null
          : null,
        processingError: row.processingError,
      })),
      totalItems,
      query,
    );
  }

  @Get('review-queue')
  @RequirePermissions(Permission['anpr:event:review'])
  @ApiOperation({
    summary: 'Captures awaiting manual review',
    description: 'Low-confidence or unreadable captures that did not open a barrier.',
  })
  async reviewQueue(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.listEvents(actor, query, AnprEventStatus.PENDING_REVIEW);
  }

  @Post('events/:id/review')
  @RequirePermissions(Permission['anpr:event:review'])
  @ApiOperation({
    summary: 'Resolve a low-confidence capture',
    description:
      'Confirm or correct the plate, or reject the capture. Every override records the ' +
      'operator, the original reading and the corrected one.',
  })
  @ApiResponse({ status: 409, description: 'Already resolved.', type: ApiErrorDto })
  async review(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveReviewDto,
  ): Promise<IngestResult> {
    return this.ingestion.resolveReview({
      anprEventId: id,
      correctedPlate: dto.correctedPlate,
      actorId: actor.id,
      organizationId: actor.organizationId,
      notes: dto.notes,
      reject: dto.reject,
    });
  }

  @Get('devices')
  @RequirePermissions(Permission['anpr:device:read'])
  @ApiOperation({ summary: 'ANPR devices and their health' })
  async devices(@CurrentUser() actor: AuthenticatedUser) {
    const siteFilter = AccessScope.siteFilter(actor);
    const devices = await this.prisma.anprDevice.findMany({
      where: {
        site: { organizationId: actor.organizationId },
        ...(siteFilter ? { siteId: siteFilter } : {}),
      },
      include: {
        site: { select: { name: true, code: true } },
        gate: { select: { code: true, name: true } },
        _count: { select: { events: true } },
      },
      orderBy: [{ siteId: 'asc' }, { code: 'asc' }],
    });

    const staleAfterMs = 15 * 60_000;
    return devices.map((device) => ({
      id: device.id,
      code: device.code,
      name: device.name,
      provider: device.provider,
      direction: device.direction,
      status: device.status,
      siteName: device.site.name,
      gateCode: device.gate?.code ?? null,
      lastEventAt: device.lastEventAt?.toISOString() ?? null,
      lastHeartbeatAt: device.lastHeartbeatAt?.toISOString() ?? null,
      // Derived rather than stored: a device that has simply gone quiet is more
      // useful to surface than a status column nobody remembers to update.
      appearsStale:
        device.lastEventAt === null ||
        Date.now() - device.lastEventAt.getTime() > staleAfterMs,
      totalEvents: device._count.events,
      confidenceThreshold: device.confidenceThreshold?.toFixed(4) ?? null,
    }));
  }
}
