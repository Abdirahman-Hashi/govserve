import { z } from 'zod';

/**
 * Card payments (FR-056). The real gateway is not chosen yet; the mock adapter stands in.
 * Card payments are confirmed only by this gateway's signed webhook, never by staff.
 */
export interface CardGatewayPort {
  createSession(input: {
    paymentId: string;
    amountCents: bigint;
    returnUrl: string;
  }): Promise<{ providerRef: string; checkoutUrl: string }>;
  getStatus(providerRef: string): Promise<'PENDING' | 'SUCCEEDED' | 'FAILED'>;
  refund(input: {
    providerRef: string;
    amountCents: bigint;
    refundId: string;
  }): Promise<{ providerRefundId: string }>;
}

export const CARD_GATEWAY = Symbol('CARD_GATEWAY');

export const CardWebhookEventSchema = z.strictObject({
  id: z.string().min(1).max(100),
  type: z.enum([
    'payment.succeeded',
    'payment.failed',
    'charge.reversed',
    'refund.succeeded',
    'refund.failed',
  ]),
  providerRef: z.string().min(1).max(100),
  amountCents: z.string().regex(/^\d{1,12}$/),
  providerRefundId: z.string().min(1).max(100).optional(),
  created: z.number().int(),
});
export type CardWebhookEvent = z.infer<typeof CardWebhookEventSchema>;

/**
 * Automatic mobile-money confirmation (FR-061). Not used at launch: mobile money is verified by
 * officers. A provider API adapter can implement this later without changing callers.
 */
export interface PaymentProviderPort {
  lookup(input: {
    provider: string;
    reference: string;
  }): Promise<{ found: boolean; amountCents?: bigint }>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export class ManualOnlyPaymentProvider implements PaymentProviderPort {
  lookup(): Promise<{ found: boolean }> {
    return Promise.resolve({ found: false });
  }
}
