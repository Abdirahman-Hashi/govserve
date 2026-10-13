import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.module';
import { type CardGatewayPort, type CardWebhookEvent } from './card-gateway.port';
import { SIGNATURE_HEADER, signWebhook } from './webhook-signature';

interface Session {
  paymentId: string;
  amountCents: bigint;
  returnUrl: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
}

/**
 * Development stand-in for a card gateway (refused in production by config). Its checkout page
 * sends real HMAC-signed webhooks to our own endpoint, so verification is exercised end to end.
 */
@Injectable()
export class MockCardGateway implements CardGatewayPort {
  private readonly logger = new Logger(MockCardGateway.name);
  readonly sessions = new Map<string, Session>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  createSession(input: { paymentId: string; amountCents: bigint; returnUrl: string }) {
    const providerRef = `mock_${randomUUID().replace(/-/g, '')}`;
    this.sessions.set(providerRef, { ...input, status: 'PENDING' });
    return Promise.resolve({
      providerRef,
      checkoutUrl: `${this.config.PUBLIC_API_URL}/api/v1/mock-gateway/checkout/${providerRef}`,
    });
  }

  getStatus(providerRef: string) {
    return Promise.resolve(this.sessions.get(providerRef)?.status ?? 'FAILED');
  }

  refund(input: { providerRef: string; amountCents: bigint; refundId: string }) {
    const providerRefundId = `mockrf_${randomUUID().replace(/-/g, '')}`;
    // Real gateways confirm refunds asynchronously; so does the mock.
    setTimeout(() => {
      void this.send(
        this.event('refund.succeeded', input.providerRef, input.amountCents, providerRefundId),
      );
    }, 200);
    return Promise.resolve({ providerRefundId });
  }

  /** Called by the mock checkout page. */
  async complete(providerRef: string, outcome: 'pay' | 'decline'): Promise<string | null> {
    const session = this.sessions.get(providerRef);
    if (!session || session.status !== 'PENDING') return session?.returnUrl ?? null;
    session.status = outcome === 'pay' ? 'SUCCEEDED' : 'FAILED';
    await this.send(
      this.event(
        outcome === 'pay' ? 'payment.succeeded' : 'payment.failed',
        providerRef,
        session.amountCents,
      ),
    );
    return session.returnUrl;
  }

  event(
    type: CardWebhookEvent['type'],
    providerRef: string,
    amountCents: bigint,
    providerRefundId?: string,
  ): CardWebhookEvent {
    return {
      id: `evt_${randomUUID().replace(/-/g, '')}`,
      type,
      providerRef,
      amountCents: amountCents.toString(),
      ...(providerRefundId && { providerRefundId }),
      created: Math.floor(Date.now() / 1000),
    };
  }

  private async send(event: CardWebhookEvent): Promise<void> {
    const body = JSON.stringify(event);
    try {
      const res = await fetch(`${this.config.PUBLIC_API_URL}/api/v1/payments/webhooks/card`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [SIGNATURE_HEADER]: signWebhook(this.config.CARD_WEBHOOK_SECRET, body),
        },
        body,
      });
      if (!res.ok)
        this.logger.warn({ status: res.status, type: event.type }, 'Mock webhook was not accepted');
    } catch (err) {
      this.logger.warn(
        { err: (err as Error).name, type: event.type },
        'Mock webhook delivery failed',
      );
    }
  }
}
