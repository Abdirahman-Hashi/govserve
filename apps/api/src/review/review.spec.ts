import { pause, resume, stopSla } from '../applications/sla';
import { approvalBlockers } from './review.service';

const at = (iso: string) => new Date(iso);

describe('SLA pause and resume', () => {
  it('should pause once and keep the first pause time', () => {
    expect(pause({ slaPausedAt: null }, at('2026-10-13T08:00:00Z'))).toEqual({
      slaPausedAt: at('2026-10-13T08:00:00Z'),
    });
    expect(pause({ slaPausedAt: at('2026-10-12T08:00:00Z') }, at('2026-10-13T08:00:00Z'))).toEqual(
      {},
    );
  });

  it('should move the due date later by the paused time and add it to the total', () => {
    const out = resume(
      {
        slaPausedAt: at('2026-10-13T08:00:00Z'),
        slaDueAt: at('2026-10-20T08:00:00Z'),
        slaPausedTotalMs: 1000n,
      },
      at('2026-10-15T08:00:00Z'),
    );
    expect(out).toEqual({
      slaPausedAt: null,
      slaPausedTotalMs: 1000n + 2n * 86_400_000n,
      slaDueAt: at('2026-10-22T08:00:00Z'),
    });
  });

  it('should do nothing when not paused, and clear a pause on a decision', () => {
    expect(resume({ slaPausedAt: null, slaDueAt: null, slaPausedTotalMs: 0n }, new Date())).toEqual(
      {},
    );
    expect(stopSla({ slaPausedAt: new Date() })).toEqual({ slaPausedAt: null });
  });
});

describe('approvalBlockers', () => {
  const base = {
    feeAssessment: { totalCents: 1500n },
    payments: [{ status: 'CONFIRMED', amountCents: 1500n }],
    chargebackFlag: false,
    appointments: [{ status: 'ATTENDED' }],
    corrections: [{ resolvedAt: new Date() }],
    service: { inPersonStep: 'FINGERPRINTS' },
  };
  const blockers = (over: object) =>
    approvalBlockers({ ...base, ...over } as unknown as Parameters<typeof approvalBlockers>[0]);

  it('should allow a paid, attended, uncorrected application', () => {
    expect(blockers({})).toEqual([]);
  });

  it('should list every unmet condition', () => {
    expect(
      blockers({
        payments: [{ status: 'CONFIRMED', amountCents: 1000n }],
        appointments: [{ status: 'NO_SHOW' }],
        corrections: [{ resolvedAt: null }],
        chargebackFlag: true,
      }),
    ).toHaveLength(4);
  });

  it('should not require an appointment when the service has no in-person step', () => {
    expect(blockers({ appointments: [], service: { inPersonStep: 'NONE' } })).toEqual([]);
  });
});
