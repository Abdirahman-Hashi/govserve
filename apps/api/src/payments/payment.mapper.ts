import { type PaymentDto } from '@govserve/shared';
import { type Payment, type Receipt, type Refund } from '../generated/prisma/client';

export type PaymentWithReceipt = Payment & {
  receipt: Pick<Receipt, 'receiptNo'> | null;
  refunds: Pick<Refund, 'status' | 'amountCents'>[];
};

export const paymentInclude = {
  receipt: { select: { receiptNo: true } },
  refunds: { select: { status: true, amountCents: true } },
} as const;

export function toPaymentDto(p: PaymentWithReceipt): PaymentDto {
  const refunded = p.refunds
    .filter((r) => r.status === 'COMPLETED')
    .reduce((s, r) => s + r.amountCents, 0n);
  return {
    id: p.id,
    applicationId: p.applicationId,
    channel: p.channel,
    provider: p.provider,
    reference: p.reference,
    amountCents: p.amountCents.toString(),
    overpaidCents: p.overpaidCents.toString(),
    refundedCents: refunded.toString(),
    paidAt: p.paidAt.toISOString(),
    status: p.status,
    rejectNote: p.rejectNote,
    receiptNo: p.receipt?.receiptNo ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}
