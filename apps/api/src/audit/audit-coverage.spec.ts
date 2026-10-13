import { auditActionsInCode, auditActionsInDoc } from './audit-actions';

describe('audit coverage table (FR-130)', () => {
  const code = auditActionsInCode();
  const doc = auditActionsInDoc();

  it('should list every audit action the code writes', () => {
    expect([...code].filter((a) => !doc.has(a)).sort()).toEqual([]);
  });

  it('should not list actions the code no longer writes', () => {
    expect([...doc].filter((a) => !code.has(a)).sort()).toEqual([]);
  });

  it('should cover the full table', () => {
    expect(doc.size).toBeGreaterThanOrEqual(90);
  });
});
