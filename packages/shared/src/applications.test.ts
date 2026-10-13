import { describe, expect, it } from 'vitest';
import { documentCompleteness } from './applications.js';
import { type RequiredDocument } from './catalogue.js';

const doc = (type: string, extra: Partial<RequiredDocument> = {}): RequiredDocument => ({
  type,
  label: type,
  mime: ['application/pdf'],
  maxBytes: 1024 * 1024,
  required: true,
  ...extra,
});
const required = [
  doc('ID'),
  doc('PHOTO'),
  doc('BIRTH_NOTE', { required: false }),
  doc('LEADER_LETTER', { oneOfGroup: 'PROOF' }),
  doc('UTILITY_BILL', { oneOfGroup: 'PROOF' }),
];

describe('documentCompleteness', () => {
  it('should be complete when every required document and one group member is CLEAN', () => {
    expect(
      documentCompleteness(required, [
        { docType: 'ID', status: 'CLEAN' },
        { docType: 'PHOTO', status: 'CLEAN' },
        { docType: 'UTILITY_BILL', status: 'CLEAN' },
      ]),
    ).toEqual({ ok: true, missing: [], notReady: [] });
  });

  it('should report missing documents and groups by name', () => {
    expect(documentCompleteness(required, [{ docType: 'ID', status: 'CLEAN' }])).toEqual({
      ok: false,
      missing: ['PHOTO', 'PROOF'],
      notReady: [],
    });
  });

  it('should treat uploads that are not CLEAN as not ready', () => {
    const r = documentCompleteness(required, [
      { docType: 'ID', status: 'QUARANTINED' },
      { docType: 'PHOTO', status: 'CLEAN' },
      { docType: 'LEADER_LETTER', status: 'INFECTED' },
    ]);
    expect(r).toEqual({ ok: false, missing: [], notReady: ['ID', 'LEADER_LETTER'] });
  });

  it('should not require optional documents', () => {
    const r = documentCompleteness([doc('BIRTH_NOTE', { required: false })], []);
    expect(r.ok).toBe(true);
  });
});
