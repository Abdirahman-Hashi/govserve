import { Module } from '@nestjs/common';
import { ReceiptsService } from '../receipts/receipts.service';
import { SigningService } from '../receipts/signing.service';
import { CARD_GATEWAY, ManualOnlyPaymentProvider, PAYMENT_PROVIDER } from './card-gateway.port';
import { MockCardGateway } from './mock-card-gateway';
import { MoneyStateService } from './money-state.service';
import { RefundsService } from './refunds.service';

/** Shared money building blocks (used by applications for refunds on withdrawal). */
@Module({
  providers: [
    MoneyStateService,
    RefundsService,
    SigningService,
    ReceiptsService,
    // Only the mock exists until a gateway is chosen; config refuses it in production.
    { provide: CARD_GATEWAY, useClass: MockCardGateway },
    { provide: PAYMENT_PROVIDER, useClass: ManualOnlyPaymentProvider },
  ],
  exports: [
    MoneyStateService,
    RefundsService,
    SigningService,
    ReceiptsService,
    CARD_GATEWAY,
    PAYMENT_PROVIDER,
  ],
})
export class MoneyModule {}
