import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { AuthenticatedUserProfile, LoginResponse } from '@smartpark/contracts';
import { ApiErrorDto } from '@/common/dto/api-error.dto';
import { AuthenticatedUser, CurrentUser, Public } from '@/common/decorators/auth.decorators';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  LoginDto,
  LoginResponseDto,
  LogoutDto,
  RefreshTokenDto,
} from './dto/auth.dto';

@ApiTags('Authentication')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Rate limited far more aggressively than the rest of the API: credential
   * stuffing is the realistic attack, and account lockout alone would let an
   * attacker lock every user out as a denial of service.
   */
  @Public()
  @Throttle({ login: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in with email and password',
    description:
      'Returns a short-lived access token and a rotating refresh token. ' +
      'Every failure returns the same INVALID_CREDENTIALS code so accounts cannot be enumerated.',
  })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid credentials.', type: ApiErrorDto })
  @ApiResponse({ status: 423, description: 'Account locked.', type: ApiErrorDto })
  @ApiResponse({ status: 429, description: 'Too many attempts.', type: ApiErrorDto })
  async login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.auth.login(dto.email, dto.password);
  }

  @Public()
  @Throttle({ login: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange a refresh token for a new token pair',
    description:
      'The presented token is revoked and replaced. Presenting an already-rotated token is ' +
      'treated as theft: the entire token family is revoked and the user must sign in again.',
  })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  @ApiResponse({ status: 401, description: 'Token invalid, expired or reused.', type: ApiErrorDto })
  async refresh(@Body() dto: RefreshTokenDto): Promise<LoginResponse> {
    return this.auth.refresh(dto.refreshToken);
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'End the current session',
    description: 'Revokes the refresh-token family. Omit the token to end every session.',
  })
  @ApiResponse({ status: 204, description: 'Session ended.' })
  async logout(
    @Body() dto: LogoutDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.auth.logout(dto.refreshToken, user.id);
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({
    summary: 'The signed-in user, with roles, permissions and site access',
    description:
      'The console calls this on load to decide which navigation and actions to render. ' +
      'It is a convenience, not a security boundary: every endpoint re-checks authorisation.',
  })
  async me(@CurrentUser() user: AuthenticatedUser): Promise<AuthenticatedUserProfile> {
    return this.auth.profileFor(user.id);
  }

  @ApiBearerAuth()
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Change your own password',
    description:
      'Requires the current password. On success every other session for this user is revoked.',
  })
  @ApiResponse({ status: 204, description: 'Password changed.' })
  @ApiResponse({ status: 400, description: 'Password policy violation.', type: ApiErrorDto })
  @ApiResponse({ status: 401, description: 'Current password incorrect.', type: ApiErrorDto })
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() _request: Request,
  ): Promise<void> {
    await this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword);
  }
}
