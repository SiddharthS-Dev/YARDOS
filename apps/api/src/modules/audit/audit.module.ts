import { Global, Module } from '@nestjs/common';

import { AuditService } from './audit.service';

/**
 * Global: virtually every module writes to the audit trail, and threading an
 * import through all of them would add noise without adding isolation.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
