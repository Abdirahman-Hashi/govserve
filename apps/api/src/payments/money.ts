import { type Payment, type Prisma } from '../generated/prisma/client';

/** Locks the application row so money operations on it run one at a time. */
export async function lockApplication(
  tx: Prisma.TransactionClient,
  applicationId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "application" WHERE "id" = ${applicationId}::uuid FOR UPDATE`;
}

/** Locks a payment row (refund caps are checked under this lock). */
export async function lockPayment(tx: Prisma.TransactionClient, paymentId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "payment" WHERE "id" = ${paymentId}::uuid FOR UPDATE`;
}

/** Sum of CONFIRMED payments (reversed or rejected money does not count). */
export function confirmedTotal(payments: Pick<Payment, 'status' | 'amountCents'>[]): bigint {
  return payments
    .filter((p) => p.status === 'CONFIRMED')
    .reduce((sum, p) => sum + p.amountCents, 0n);
}

/** Upper-case, no spaces or dashes: "tx 12-34" and "TX1234" are the same reference (FR-052). */
export function normaliseReference(reference: string): string {
  return reference.toUpperCase().replace(/[\s-]+/g, '');
}

export function normaliseProvider(provider: string): string {
  return provider.trim().toUpperCase().replace(/\s+/g, '_');
}

export const max = (a: bigint, b: bigint): bigint => (a > b ? a : b);
export const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);

/**
 * How a newly confirmed payment counts (FR-057): the part above what was still owed is
 * overpayment; money arriving when the application no longer awaits payment is all overpayment.
 */
export function allocate(input: {
  assessed: bigint;
  paidBefore: bigint;
  amount: bigint;
  awaitingPayment: boolean;
}): {
  overpaid: bigint;
  fullyPaid: boolean;
} {
  const { assessed, paidBefore, amount, awaitingPayment } = input;
  if (!awaitingPayment) return { overpaid: amount, fullyPaid: false };
  const owed = max(assessed - paidBefore, 0n);
  return { overpaid: max(amount - owed, 0n), fullyPaid: paidBefore + amount >= assessed };
}
