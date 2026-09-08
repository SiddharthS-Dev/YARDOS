import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Paginated, Permission } from '@smartpark/contracts';
import { ApiErrorDto } from '@/common/dto/api-error.dto';
import {
  AuthenticatedUser,
  CurrentUser,
  RequirePermissions,
} from '@/common/decorators/auth.decorators';
import { Audited } from '@/common/decorators/audited.decorator';
import { UserSummary, UsersService } from './users.service';
import {
  CreateUserDto,
  ListUsersQueryDto,
  SetRolesDto,
  SetSiteAccessDto,
  SetUserStatusDto,
} from './dto/users.dto';

@ApiTags('Users & roles')
@ApiBearerAuth()
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(Permission['user:read'])
  @ApiOperation({ summary: 'List users' })
  async list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListUsersQueryDto,
  ): Promise<Paginated<UserSummary>> {
    return this.users.list(actor, query, {
      search: query.search,
      status: query.status,
      roleCode: query.roleCode,
      financierId: query.financierId,
    });
  }

  @Get('roles')
  @RequirePermissions(Permission['role:read'])
  @ApiOperation({
    summary: 'List roles and their permissions',
    description: 'The console uses this to render the role picker and the permission matrix.',
  })
  async roles(@CurrentUser() actor: AuthenticatedUser) {
    return this.users.listRoles(actor);
  }

  @Get(':id')
  @RequirePermissions(Permission['user:read'])
  @ApiOperation({ summary: 'Get one user' })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async findOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserSummary> {
    return this.users.findById(actor, id);
  }

  @Post()
  @RequirePermissions(Permission['user:write'])
  @Audited({ action: 'USER.CREATED', entityType: 'User', entityIdFrom: 'result:user.id' })
  @ApiOperation({
    summary: 'Create a user',
    description:
      'When no password is supplied a temporary one is generated and returned exactly once. ' +
      'It is never stored in plaintext, logged, or retrievable afterwards.',
  })
  @ApiResponse({ status: 409, description: 'Email already in use.', type: ApiErrorDto })
  async create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateUserDto) {
    return this.users.create(actor, {
      email: dto.email,
      fullName: dto.fullName,
      phone: dto.phone,
      roleCodes: dto.roleCodes,
      siteIds: dto.siteIds,
      financierId: dto.financierId ?? null,
      password: dto.password,
    });
  }

  @Patch(':id/roles')
  @RequirePermissions(Permission['user:write'], Permission['role:write'])
  @ApiOperation({
    summary: 'Replace a user\'s roles',
    description: 'Existing sessions are revoked so a removed permission stops applying at once.',
  })
  async setRoles(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetRolesDto,
  ): Promise<UserSummary> {
    return this.users.setRoles(actor, id, dto.roleCodes);
  }

  @Patch(':id/site-access')
  @RequirePermissions(Permission['user:write'])
  @ApiOperation({ summary: 'Replace a user\'s site grants' })
  async setSiteAccess(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetSiteAccessDto,
  ): Promise<UserSummary> {
    return this.users.setSiteAccess(actor, id, dto.siteIds);
  }

  @Patch(':id/status')
  @RequirePermissions(Permission['user:write'])
  @ApiOperation({
    summary: 'Activate, suspend or disable a user',
    description: 'A reason is mandatory and is recorded in the audit trail.',
  })
  async setStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetUserStatusDto,
  ): Promise<UserSummary> {
    return this.users.setStatus(actor, id, dto.status, dto.reason);
  }

  @Post(':id/reset-password')
  @RequirePermissions(Permission['user:write'])
  @ApiOperation({
    summary: 'Issue a new temporary password',
    description:
      'Returns the temporary password once. All of that user\'s sessions are revoked and they ' +
      'must change it at next sign-in.',
  })
  async resetPassword(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ temporaryPassword: string }> {
    return this.users.resetPassword(actor, id);
  }
}
