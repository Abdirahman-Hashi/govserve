import { Global, Module } from '@nestjs/common';
import { AuditQueryService } from './audit-query.service';
import { AuditVerifierService } from './audit-verifier.service';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditQueryService, AuditVerifierService],
  exports: [AuditService, AuditVerifierService],
})
export class AuditModule {}
