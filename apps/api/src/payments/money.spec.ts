import fc from 'fast-check';
import { allocate, confirmedTotal, normaliseReference } from './money';

const cents = fc.bigInt({ min: 0n, max: 100_000_000n });
const positive = fc.bigInt({ min: 1n, max: 100_000_000n });

describe('allocate (FR-057)', () => {
  it('should never count more overpayment than the payment, nor a negative amount', () => {
    fc.assert(
      fc.property(
        cents,
        cents,
        positive,
        fc.boolean(),
        (assessed, paidBefore, amount, awaiting) => {
          const { overpaid } = allocate({
            assessed,
            paidBefore,
            amount,
            awaitingPayment: awaiting,
          });
          expect(overpaid >= 0n && overpaid <= amount).toBe(true);
        },
      ),
    );
  });

  it('should split a payment into exactly what was owed plus overpayment', () => {
    fc.assert(
      fc.property(cents, positive, (assessed, amount) => {
        fc.pre(assessed > 0n);
        const paidBefore = assessed / 3n;
        const { overpaid, fullyPaid } = allocate({
          assessed,
          paidBefore,
          amount,
          awaitingPayment: true,
        });
        const owed = assessed - paidBefore;
        expect(overpaid).toBe(amount > owed ? amount - owed : 0n);
        expect(fullyPaid).toBe(paidBefore + amount >= assessed);
      }),
    );
  });

  it('should queue only when the running total reaches the fee', () => {
    // $19.00 fee paid as $10.00 then $9.00 then an extra $5.00.
    expect(
      allocate({ assessed: 1900n, paidBefore: 0n, amount: 1000n, awaitingPayment: true }),
    ).toEqual({ overpaid: 0n, fullyPaid: false });
    expect(
      allocate({ assessed: 1900n, paidBefore: 1000n, amount: 900n, awaitingPayment: true }),
    ).toEqual({ overpaid: 0n, fullyPaid: true });
    expect(
      allocate({ assessed: 1900n, paidBefore: 1900n, amount: 500n, awaitingPayment: false }),
    ).toEqual({ overpaid: 500n, fullyPaid: false });
  });

  it('should treat a single large payment as fee plus overpayment', () => {
    expect(
      allocate({ assessed: 1900n, paidBefore: 0n, amount: 2400n, awaitingPayment: true }),
    ).toEqual({ overpaid: 500n, fullyPaid: true });
  });
});

describe('confirmedTotal', () => {
  it('should count only CONFIRMED payments', () => {
    const total = confirmedTotal([
      { status: 'CONFIRMED', amountCents: 1000n },
      { status: 'PENDING_VERIFICATION', amountCents: 900n },
      { status: 'REVERSED', amountCents: 500n },
      { status: 'CONFIRMED', amountCents: 250n },
    ]);
    expect(total).toBe(1250n);
  });
});

describe('normaliseReference (FR-052)', () => {
  it('should treat case, spaces and dashes as the same reference', () => {
    expect(normaliseReference(' tx 12-34 ')).toBe(normaliseReference('TX1234'));
  });
});
