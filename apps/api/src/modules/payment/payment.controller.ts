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
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { PaymentMethod, PaymentStatus } from '@prisma/client';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

import { HEADER_PAYMENT_SIGNATURE, Paginated, Permission } from '@smartpark/contracts';
import { ApiErrorDto } from '@/common/dto/api-error.dto';
import { rawBodyOf } from '@/common/util/raw-body';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import {
  AuthenticatedUser,
  CurrentUser,
  Public,
  RequirePermissions,
} from '@/common/decorators/auth.decorators';
import { PaymentDetail, PaymentListItem, PaymentService } from './payment.service';

class RecordPaymentDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsUUID()
  invoiceId!: string;

  @ApiPropertyOptional({
    description: 'Decimal string, e.g. "1250.0000". Never a JSON number.',
    example: '1250.0000',
  })
  @IsString()
  @Matches(/^\d{1,14}(\.\d{1,4})?$/, {
    message: 'amount must be a positive decimal string with at most 4 decimal places',
  })
  amount!: string;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @ApiPropertyOptional({ description: 'UTR, cheque number or receipt reference.' })
  @IsOptional() @IsString() @MaxLength(128)
  reference?: string;

  @ApiPropertyOptional({
    description:
      'Client-supplied idempotency key. Retrying with the same key returns the original ' +
      'payment instead of double-crediting the invoice.',
  })
  @IsString() @MaxLength(128)
  idempotencyKey!: string;
}

class ListPaymentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  invoiceId?: string;

  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional() @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional() @IsEnum(PaymentMethod)
  method?: PaymentMethod;
}

@ApiTags('Payments')
@Controller({ path: 'payments', version: '1' })
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  @ApiBearerAuth()
  @Get()
  @RequirePermissions(Permission['payment:read'])
  @ApiOperation({ summary: 'List payments' })
  async list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListPaymentsQueryDto,
  ): Promise<Paginated<PaymentListItem>> {
    return this.payments.list(actor, query, {
      invoiceId: query.invoiceId,
      status: query.status,
      method: query.method,
    });
  }

  @ApiBearerAuth()
  @Get(':id')
  @RequirePermissions(Permission['payment:read'])
  @ApiOperation({ summary: 'One payment' })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async findOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaymentDetail> {
    return this.payments.findById(actor, id);
  }

  @ApiBearerAuth()
  @Post()
  @RequirePermissions(Permission['payment:record'])
  @ApiOperation({
    summary: 'Record a payment received outside a gateway',
    description:
      'Bank transfer, cheque, UPI or cash at the counter. Settles the invoice immediately, ' +
      'because a member of staff is asserting the money arrived - and the audit record names ' +
      'them. Amounts are decimal strings; the resulting invoice status is derived from the ' +
      'arithmetic, never supplied by the caller.',
  })
  @ApiResponse({ status: 400, description: 'Payment exceeds the balance.', type: ApiErrorDto })
  @ApiResponse({ status: 409, description: 'Invoice is not payable.', type: ApiErrorDto })
  async record(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: RecordPaymentDto,
  ): Promise<PaymentDetail> {
    return this.payments.recordManualPayment(actor, {
      invoiceId: dto.invoiceId,
      amount: dto.amount,
      method: dto.method,
      reference: dto.reference ?? null,
      idempotencyKey: dto.idempotencyKey,
      actorId: actor.id,
      organizationId: actor.organizationId,
    });
  }

  /**
   * Gateway callback.
   *
   * Public because a gateway cannot hold a bearer token — authenticity comes
   * from the HMAC signature instead, verified in constant time before the
   * payload is allowed to influence anything.
   */
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Payment gateway callback',
    description:
      'Authenticated by signature, not by bearer token. Every callback is stored keyed on the ' +
      'provider event id BEFORE processing, so a duplicate delivery collides on the unique ' +
      'index and returns the original outcome. A callback whose amount disagrees with the ' +
      'payment is recorded and refused.',
  })
  @ApiResponse({ status: 200, description: 'Callback accepted (or recognised as a duplicate).' })
  @ApiResponse({ status: 401, description: 'Signature invalid.', type: ApiErrorDto })
  async webhook(
    @Body() payload: Record<string, unknown>,
    @Req() request: RawBodyRequest<Request>,
    @Headers(HEADER_PAYMENT_SIGNATURE) signature?: string,
  ): Promise<{ processed: boolean; duplicate: boolean; paymentId: string | null; reason?: string }> {
    return this.payments.handleWebhook({
      payload,
      // The exact bytes the gateway signed. Not a re-serialisation of the
      // parsed body: `JSON.stringify` would reorder keys, drop the sender's
      // whitespace and re-escape non-ASCII, and the HMAC would then be
      // computed over a document the gateway never sent.
      rawBody: rawBodyOf(request),
      signature,
    });
  }
}
