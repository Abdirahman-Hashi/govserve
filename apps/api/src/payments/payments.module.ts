import { Module } from '@nestjs/common';
import { ApplicationsModule } from '../applications/applications.module';
import { CertificatesModule } from '../certificates/certificates.module';
import { ConfigAdminModule } from '../config-admin/config-admin.module';
import { VerifyController } from '../receipts/verify.controller';
import { MoneyModule } from './money.module';
import { PaymentsController, RefundsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { CardWebhookController, MockGatewayController } from './webhooks.controller';

@Module({
  imports: [MoneyModule, ApplicationsModule, ConfigAdminModule, CertificatesModule],
  controllers: [
    PaymentsController,
    RefundsController,
    CardWebhookController,
    MockGatewayController,
    VerifyController,
  ],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
