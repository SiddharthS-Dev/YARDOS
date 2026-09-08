import { Global, Module } from '@nestjs/common';

import { EncryptionService } from './encryption.service';
import { PasswordHasher } from './password-hasher.service';

@Global()
@Module({
  providers: [PasswordHasher, EncryptionService],
  exports: [PasswordHasher, EncryptionService],
})
export class CryptoModule {}
