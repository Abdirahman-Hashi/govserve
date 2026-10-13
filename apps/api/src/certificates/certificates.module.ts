import { Module } from '@nestjs/common';
import { ApplicationsModule } from '../applications/applications.module';
import { MoneyModule } from '../payments/money.module';
import { CertificateVerifyController, CertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';

@Module({
  imports: [ApplicationsModule, MoneyModule],
  controllers: [CertificatesController, CertificateVerifyController],
  providers: [CertificatesService],
  exports: [CertificatesService],
})
export class CertificatesModule {}
