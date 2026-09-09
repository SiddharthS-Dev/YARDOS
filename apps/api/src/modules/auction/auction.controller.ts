import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuctionStatus, BidChannel } from '@prisma/client';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { Paginated, Permission } from '@smartpark/contracts';
import { ApiErrorDto } from '@/common/dto/api-error.dto';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import {
  AuthenticatedUser,
  CurrentUser,
  RequireAnyPermission,
  RequirePermissions,
} from '@/common/decorators/auth.decorators';
import {
  AuctionDetail,
  AuctionListItem,
  AuctionService,
  BidResult,
  BidderItem,
  LotDetail,
  SettlementDetail,
} from './auction.service';

/** Money crosses the wire as a decimal string, never a JSON number. */
const MONEY = /^\d{1,14}(\.\d{1,4})?$/;
const moneyMessage = 'must be a positive decimal string with at most 4 decimal places';

class CreateAuctionDto {
  @ApiPropertyOptional() @IsString() @MinLength(3) @MaxLength(200)
  title!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID()
  siteId?: string;

  @ApiPropertyOptional() @IsISO8601()
  scheduledStartAt!: string;

  @ApiPropertyOptional() @IsISO8601()
  scheduledEndAt!: string;

  @ApiPropertyOptional({ example: '2500.0000' })
  @IsString() @Matches(MONEY, { message: `defaultMinIncrement ${moneyMessage}` })
  defaultMinIncrement!: string;

  @ApiPropertyOptional({ example: '25000.0000', description: 'Deposit required to register.' })
  @IsOptional() @IsString() @Matches(MONEY, { message: `registrationDeposit ${moneyMessage}` })
  registrationDeposit?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(8000)
  termsAndConditions?: string;
}

class AddLotDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsUUID()
  vehicleId!: string;

  @ApiPropertyOptional({ example: '85000.0000' })
  @IsString() @Matches(MONEY, { message: `reservePrice ${moneyMessage}` })
  reservePrice!: string;

  @ApiPropertyOptional({ description: 'Overrides the auction default.' })
  @IsOptional() @IsString() @Matches(MONEY, { message: `minIncrement ${moneyMessage}` })
  minIncrement?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  conditionNotes?: string;
}

class PlaceBidDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsUUID()
  bidderId!: string;

  @ApiPropertyOptional({ example: '90000.0000' })
  @IsString() @Matches(MONEY, { message: `amount ${moneyMessage}` })
  amount!: string;

  @ApiPropertyOptional({ enum: BidChannel }) @IsOptional() @IsEnum(BidChannel)
  channel?: BidChannel;

  @ApiPropertyOptional({ description: 'Retrying with the same key returns the original bid.' })
  @IsString() @MaxLength(128)
  idempotencyKey!: string;

  // NOTE: there is deliberately no `onBehalf` field. Whether a bid was entered
  // by an administrator for a hall bidder is derived from the caller's
  // permissions, not asserted by the client - otherwise a portal bidder could
  // mislabel their own bid, or an administrator could hide that they placed one.
}

class SelectWinnerDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Overrides the automatic highest-bid pick. Audited as a manual selection.',
  })
  @IsOptional() @IsUUID()
  bidId?: string;
}

class CreateSettlementDto {
  @ApiPropertyOptional({ description: "Buyer's premium and similar. No default is assumed." })
  @IsOptional() @IsString() @Matches(MONEY, { message: `feesAmount ${moneyMessage}` })
  feesAmount?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(MONEY, { message: `taxAmount ${moneyMessage}` })
  taxAmount?: string;

  @ApiPropertyOptional() @IsOptional() @IsISO8601()
  dueDate?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}

class RecordReceiptDto {
  @ApiPropertyOptional({ example: '90000.0000' })
  @IsString() @Matches(MONEY, { message: `amount ${moneyMessage}` })
  amount!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(128)
  reference?: string;
}

class CreateBidderDto {
  @ApiPropertyOptional() @IsString() @MinLength(2) @MaxLength(256) legalName!: string;
  @ApiPropertyOptional() @IsString() @MinLength(2) @MaxLength(128) displayName!: string;
  @ApiPropertyOptional() @IsString() @MinLength(2) @MaxLength(160) contactName!: string;
  @ApiPropertyOptional() @IsString() @MinLength(6) @MaxLength(32) phone!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(256) email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(16) pan?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) gstin?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(128) city?: string;
}

class RegisterBidderDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsUUID()
  bidderId!: string;

  @ApiPropertyOptional({ example: '25000.0000' })
  @IsString() @Matches(MONEY, { message: `depositPaid ${moneyMessage}` })
  depositPaid!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(128)
  depositReference?: string;
}

class ListAuctionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AuctionStatus, isArray: true })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]).filter(Boolean))
  @IsArray() @IsEnum(AuctionStatus, { each: true })
  status?: AuctionStatus[];
}

@ApiTags('Auctions')
@ApiBearerAuth()
@Controller({ path: 'auctions', version: '1' })
export class AuctionController {
  constructor(private readonly auctions: AuctionService) {}

  /* --- Auctions --------------------------------------------------- */

  @Get()
  @RequirePermissions(Permission['auction:read'])
  @ApiOperation({ summary: 'List auctions' })
  async list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListAuctionsQueryDto,
  ): Promise<Paginated<AuctionListItem>> {
    return this.auctions.listAuctions(actor, query, { status: query.status });
  }

  @Get(':id')
  @RequirePermissions(Permission['auction:read'])
  @ApiOperation({ summary: 'One auction, with its lots and registrations' })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async findOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AuctionDetail> {
    return this.auctions.findAuctionById(actor, id);
  }

  @Post()
  @RequirePermissions(Permission['auction:write'])
  @ApiOperation({ summary: 'Create an auction' })
  async create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateAuctionDto,
  ): Promise<AuctionDetail> {
    return this.auctions.createAuction(actor, {
      title: dto.title,
      description: dto.description ?? null,
      siteId: dto.siteId ?? null,
      scheduledStartAt: new Date(dto.scheduledStartAt),
      scheduledEndAt: new Date(dto.scheduledEndAt),
      defaultMinIncrement: dto.defaultMinIncrement,
      registrationDeposit: dto.registrationDeposit ?? null,
      termsAndConditions: dto.termsAndConditions ?? null,
    });
  }

  @Post(':id/publish')
  @RequirePermissions(Permission['auction:publish'])
  @ApiOperation({
    summary: 'Publish an auction',
    description: 'Refused when the auction has no lots.',
  })
  async publish(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AuctionDetail> {
    // DRAFT auctions are scheduled first; this makes publishing a single click.
    const current = await this.auctions.findAuctionById(actor, id);
    if (current.status === AuctionStatus.DRAFT) {
      await this.auctions.transitionAuction(actor, id, AuctionStatus.SCHEDULED);
    }
    return this.auctions.transitionAuction(actor, id, AuctionStatus.PUBLISHED);
  }

  @Post(':id/open')
  @RequirePermissions(Permission['auction:open'])
  @ApiOperation({
    summary: 'Open bidding',
    description: 'Opens every listed lot and moves their vehicles to BIDDING_OPEN.',
  })
  async open(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AuctionDetail> {
    return this.auctions.transitionAuction(actor, id, AuctionStatus.OPEN);
  }

  @Post(':id/close')
  @RequirePermissions(Permission['auction:close'])
  @ApiOperation({
    summary: 'Close bidding',
    description:
      'Closes every open lot. Deliberately separate from winner selection, which is a ' +
      'different permission, so one person cannot run an auction end to end alone.',
  })
  async close(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AuctionDetail> {
    return this.auctions.transitionAuction(actor, id, AuctionStatus.CLOSED);
  }

  /* --- Lots -------------------------------------------------------- */

  @Post(':id/lots')
  @RequirePermissions(Permission['auction:write'])
  @ApiOperation({
    summary: 'Add a vehicle as a lot',
    description:
      'Refused unless the vehicle is currently in the yard, not under hold, and not already ' +
      'in a live auction.',
  })
  @ApiResponse({ status: 409, description: 'Vehicle not eligible.', type: ApiErrorDto })
  async addLot(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddLotDto,
  ): Promise<LotDetail> {
    return this.auctions.addLot(actor, id, {
      vehicleId: dto.vehicleId,
      reservePrice: dto.reservePrice,
      minIncrement: dto.minIncrement ?? null,
      description: dto.description ?? null,
      conditionNotes: dto.conditionNotes ?? null,
    });
  }

  @Get('lots/:lotId')
  @RequirePermissions(Permission['auction:read'])
  @ApiOperation({
    summary: 'One lot, with its full bid ladder',
    description:
      'Superseded bids are present and marked OUTBID/LOST, never removed - the ladder is the ' +
      'auction\'s evidence.',
  })
  async lot(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('lotId', ParseUUIDPipe) lotId: string,
  ): Promise<LotDetail> {
    return this.auctions.findLotById(actor, lotId);
  }

  /* --- Bidding ------------------------------------------------------ */

  @Post('lots/:lotId/bids')
  // Either permission admits: `bid:place` is a bidder acting for themselves,
  // `bid:place:onbehalf` is an auction administrator entering a hall bid.
  @RequireAnyPermission(Permission['bid:place'], Permission['bid:place:onbehalf'])
  @ApiOperation({
    summary: 'Place a bid',
    description:
      'Validated server-side: the auction must be open and inside its window, the bidder ' +
      'approved and registered for THIS auction, and the amount must clear both the reserve ' +
      'and the standing high bid plus the increment. Bids serialise on a unique index, so ' +
      'simultaneous bids cannot take the same position.',
  })
  @ApiResponse({ status: 403, description: 'Bidder not approved or not registered.', type: ApiErrorDto })
  @ApiResponse({ status: 409, description: 'Bidding is not open.', type: ApiErrorDto })
  @ApiResponse({ status: 422, description: 'Below reserve or below increment.', type: ApiErrorDto })
  async placeBid(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('lotId', ParseUUIDPipe) lotId: string,
    @Body() dto: PlaceBidDto,
  ): Promise<BidResult> {
    // A caller who can only place on behalf of others is, by definition,
    // placing on behalf of someone else.
    const canPlaceOwn = actor.permissions.has(Permission['bid:place']);
    const onBehalf = !canPlaceOwn;

    return this.auctions.placeBid(actor, {
      lotId,
      bidderId: dto.bidderId,
      amount: dto.amount,
      channel: dto.channel ?? (onBehalf ? BidChannel.HALL : BidChannel.PORTAL),
      idempotencyKey: dto.idempotencyKey,
      onBehalf,
    });
  }

  @Post('lots/:lotId/select-winner')
  @RequirePermissions(Permission['auction:selectwinner'])
  @ApiOperation({
    summary: 'Select the winning bid',
    description:
      'Takes the highest accepted bid unless one is named explicitly. A lot can never acquire ' +
      'a second winner - enforced by a unique constraint as well as by this check.',
  })
  @ApiResponse({ status: 409, description: 'A winner is already selected.', type: ApiErrorDto })
  async selectWinner(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('lotId', ParseUUIDPipe) lotId: string,
    @Body() dto: SelectWinnerDto,
  ): Promise<LotDetail> {
    return this.auctions.selectWinner(actor, lotId, dto.bidId ?? null);
  }

  /* --- Settlement ---------------------------------------------------- */

  @Post('lots/:lotId/settlement')
  @RequirePermissions(Permission['settlement:write'])
  @ApiOperation({
    summary: 'Raise the settlement for a won lot',
    description:
      "Fees and tax are supplied by the operator; no buyer's premium or tax rate is assumed, " +
      'because auction commercial terms are an unresolved business item (OI-02/OI-03).',
  })
  @ApiResponse({ status: 409, description: 'Settlement already exists.', type: ApiErrorDto })
  async createSettlement(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('lotId', ParseUUIDPipe) lotId: string,
    @Body() dto: CreateSettlementDto,
  ): Promise<SettlementDetail> {
    return this.auctions.createSettlement(actor, lotId, {
      feesAmount: dto.feesAmount ?? null,
      taxAmount: dto.taxAmount ?? null,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      notes: dto.notes ?? null,
    });
  }

  @Post('settlements/:settlementId/receipts')
  @RequirePermissions(Permission['settlement:write'])
  @ApiOperation({
    summary: 'Record money received against a settlement',
    description:
      'When fully received the lot settles and the vehicle moves SETTLED then SOLD - explicit ' +
      'transitions, because a settlement existing is not the same as a vehicle being disposed of.',
  })
  async recordReceipt(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('settlementId', ParseUUIDPipe) settlementId: string,
    @Body() dto: RecordReceiptDto,
  ): Promise<SettlementDetail> {
    return this.auctions.recordSettlementReceipt(actor, settlementId, {
      amount: dto.amount,
      reference: dto.reference ?? null,
    });
  }

  @Get('settlements/:settlementId')
  @RequirePermissions(Permission['settlement:read'])
  @ApiOperation({ summary: 'One settlement' })
  async settlement(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('settlementId', ParseUUIDPipe) settlementId: string,
  ): Promise<SettlementDetail> {
    return this.auctions.findSettlementById(actor, settlementId);
  }

  /* --- Bidders -------------------------------------------------------- */

  @Get('bidders/all')
  @RequirePermissions(Permission['bidder:read'])
  @ApiOperation({ summary: 'List bidders' })
  async listBidders(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<BidderItem>> {
    return this.auctions.listBidders(actor, query);
  }

  @Post('bidders')
  @RequirePermissions(Permission['bidder:write'])
  @ApiOperation({
    summary: 'Register a bidder',
    description: 'Created as KYC_PENDING. Registration alone confers no ability to bid.',
  })
  async createBidder(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateBidderDto,
  ): Promise<BidderItem> {
    return this.auctions.createBidder(actor, {
      legalName: dto.legalName,
      displayName: dto.displayName,
      contactName: dto.contactName,
      phone: dto.phone,
      email: dto.email ?? null,
      pan: dto.pan ?? null,
      gstin: dto.gstin ?? null,
      city: dto.city ?? null,
    });
  }

  @Post('bidders/:bidderId/approve')
  @RequirePermissions(Permission['bidder:approve'])
  @ApiOperation({ summary: 'Approve a bidder after KYC' })
  async approveBidder(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('bidderId', ParseUUIDPipe) bidderId: string,
  ): Promise<BidderItem> {
    return this.auctions.approveBidder(actor, bidderId);
  }

  @Post(':id/registrations')
  @RequirePermissions(Permission['bidder:approve'])
  @ApiOperation({
    summary: 'Register an approved bidder for an auction',
    description: 'Enforces the auction deposit requirement when one is configured.',
  })
  async register(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegisterBidderDto,
  ): Promise<{ registrationId: string; status: string }> {
    return this.auctions.registerBidderForAuction(
      actor,
      id,
      dto.bidderId,
      dto.depositPaid,
      dto.depositReference ?? null,
    );
  }
}
