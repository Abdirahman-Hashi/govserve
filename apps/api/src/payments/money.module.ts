import { Module } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { APP_CONFIG, type AppConfig } from '../config/config.module';
import { DisabledCardGateway } from './disabled-card-gateway';
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
    // The mock (local, staging) or no card payments at all (production until O-7).
    {
      provide: CARD_GATEWAY,
      inject: [APP_CONFIG, ModuleRef],
      useFactory: (config: AppConfig, refs: ModuleRef) =>
        config.CARD_GATEWAY === 'mock' ? refs.create(MockCardGateway) : new DisabledCardGateway(),
    },
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
