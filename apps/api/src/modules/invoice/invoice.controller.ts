import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { InvoiceStatus, InvoiceType } from '@prisma/client';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

import { Paginated, Permission } from '@smartpark/contracts';
import { ApiErrorDto } from '@/common/dto/api-error.dto';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import {
  AuthenticatedUser,
  CurrentUser,
  RequirePermissions,
} from '@/common/decorators/auth.decorators';
import { InvoiceDetail, InvoiceListItem, InvoiceService } from './invoice.service';

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1';

class ListInvoicesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: InvoiceStatus, isArray: true })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]).filter(Boolean))
  @IsArray() @IsEnum(InvoiceStatus, { each: true })
  status?: InvoiceStatus[];

  @ApiPropertyOptional({ enum: InvoiceType })
  @IsOptional() @IsEnum(InvoiceType)
  type?: InvoiceType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  financierId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  siteId?: string;

  @ApiPropertyOptional({ description: 'Invoice number, party name or registration number.' })
  @IsOptional() @IsString() @MaxLength(64)
  search?: string;

  @ApiPropertyOptional({ description: 'Only invoices with a balance outstanding.' })
  @IsOptional() @Transform(toBool) @IsBoolean()
  outstandingOnly?: boolean;

  @ApiPropertyOptional({ description: 'Only invoices past their due date.' })
  @IsOptional() @Transform(toBool) @IsBoolean()
  overdueOnly?: boolean;
}

class VoidInvoiceDto {
  @ApiPropertyOptional({ description: 'Why the invoice is being voided. Audited.' })
  @IsString() @MinLength(5) @MaxLength(512)
  reason!: string;
}

@ApiTags('Invoices')
@ApiBearerAuth()
@Controller({ path: 'invoices', version: '1' })
export class InvoiceController {
  constructor(private readonly invoices: InvoiceService) {}

  @Get()
  @RequirePermissions(Permission['invoice:read'])
  @ApiOperation({
    summary: 'List invoices',
    description:
      'Scoped to the caller\'s sites, and to their own financier for portal users.',
  })
  async list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListInvoicesQueryDto,
  ): Promise<Paginated<InvoiceListItem>> {
    return this.invoices.list(actor, query, {
      status: query.status,
      type: query.type,
      financierId: query.financierId,
      siteId: query.siteId,
      search: query.search,
      outstandingOnly: query.outstandingOnly,
      overdueOnly: query.overdueOnly,
    });
  }

  @Get(':id')
  @RequirePermissions(Permission['invoice:read'])
  @ApiOperation({
    summary: 'One invoice, with lines, tax, payments and the charge workings',
    description:
      'Includes the billing rule that chose the bill-to party and the charge engine narrative, ' +
      'so the amount can be explained to a financier without leaving the screen.',
  })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async findOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InvoiceDetail> {
    return this.invoices.findById(actor, id);
  }

  @Post(':id/issue')
  @RequirePermissions(Permission['invoice:issue'])
  @ApiOperation({
    summary: 'Issue an invoice',
    description:
      'The point at which it becomes a financial document. After this a database trigger ' +
      'freezes its number, amounts and party; corrections require a void plus credit note.',
  })
  @ApiResponse({ status: 409, description: 'Not in an issuable state.', type: ApiErrorDto })
  async issue(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InvoiceDetail> {
    return this.invoices.issue(actor, id);
  }

  @Post(':id/void')
  @RequirePermissions(Permission['invoice:void'])
  @ApiOperation({
    summary: 'Void an invoice and raise a credit note',
    description:
      'The only sanctioned reversal. The original is left exactly as issued; a credit note ' +
      'carries the reversing entry, so the ledger stays auditable.',
  })
  @ApiResponse({ status: 409, description: 'Cannot be voided from this state.', type: ApiErrorDto })
  async voidInvoice(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidInvoiceDto,
  ): Promise<{ invoice: InvoiceDetail; creditNoteId: string | null }> {
    return this.invoices.voidInvoice(actor, id, dto.reason);
  }
}
