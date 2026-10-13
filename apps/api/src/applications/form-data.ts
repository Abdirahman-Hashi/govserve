import { type FormSchema, type FormValues, listPiiFields } from '@govserve/shared';
import { type CryptoService } from '../crypto/crypto.service';
import { type ApplicationData } from '../generated/prisma/client';

/** Splits answers into plain values and the x-pii values that are stored encrypted (NFR-002). */
export function splitPii(
  schema: FormSchema,
  values: FormValues,
): { plain: FormValues; pii: FormValues } {
  const piiNames = new Set(listPiiFields(schema));
  const plain: FormValues = {};
  const pii: FormValues = {};
  for (const [k, v] of Object.entries(values)) (piiNames.has(k) ? pii : plain)[k] = v;
  return { plain, pii };
}

/**
 * Fields with a fixed meaning across services. Services for "self or a child" must define the
 * subject fields so the subject can be identified (enforced when such a version is published).
 */
export const SUBJECT_FIELDS = [
  'relationship',
  'subjectFullName',
  'dateOfBirth',
  'motherFullName',
] as const;
export const NAME_FIELDS = ['subjectFullName', 'fullName'] as const;
export const NATIONAL_ID_FIELD = 'idNumber';

export function subjectName(values: FormValues): string | null {
  for (const f of NAME_FIELDS) if (typeof values[f] === 'string') return values[f];
  return null;
}

/** Normalised identity of a child subject, hashed by the caller (FR-031). */
export function childSubjectIdentity(values: FormValues): string {
  const norm = (v: FormValues[string] | undefined) =>
    String(v ?? '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, ' ');
  return [values['subjectFullName'], values['dateOfBirth'], values['motherFullName']]
    .map(norm)
    .join('|');
}

/** Plain answers merged with the decrypted PII blob. */
export function readFormValues(
  crypto: CryptoService,
  data: Pick<ApplicationData, 'data' | 'piiEnc'> | null,
): FormValues {
  if (!data) return {};
  const pii = data.piiEnc ? (JSON.parse(crypto.decrypt(data.piiEnc)) as FormValues) : {};
  return { ...(data.data as FormValues), ...pii };
}
