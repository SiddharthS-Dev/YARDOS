import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { AuditModule } from '@/modules/audit/audit.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy, PermissionsGuard } from './guards';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Identity and access.
 *
 * JwtModule is registered without a global secret on purpose: access and
 * refresh tokens are signed with DIFFERENT secrets, supplied per call, so a
 * refresh token can never be accepted where an access token is expected even
 * if the `typ` claim check were bypassed.
 */
@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({}), AuditModule],
  controllers: [AuthController, UsersController],
  providers: [AuthService, UsersService, JwtStrategy, PermissionsGuard],
  exports: [AuthService, UsersService],
})
export class IdentityModule {}
