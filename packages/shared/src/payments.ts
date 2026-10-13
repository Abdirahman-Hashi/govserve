import { z } from 'zod';
import { CentsStringSchema } from './catalogue.js';
import { PaymentStatus, RefundStatus } from './enums.js';

export const PaymentChannels = ['MOBILE_MONEY', 'BANK', 'CASH', 'CARD'] as const;
export type PaymentChannel = (typeof PaymentChannels)[number];

/** Mobile-money wallets accepted in Banadir. OPEN (owner: Abdirahman Hashi): confirm the official list. */
export const MobileMoneyProviders = [
  'EVC_PLUS',
  'SAHAL',
  'EDAHAB',
  'JEEB',
  'PREMIER_WALLET',
  'OTHER',
] as const;
export const RefundReasons = [
  'WITHDRAWN_BEFORE_REVIEW',
  'DUPLICATE_PAYMENT',
  'OVERPAYMENT',
  'ABANDONED_UNPAID',
] as const;
export const PayoutMethods = ['MOBILE_MONEY', 'BANK', 'CASH', 'CARD'] as const;

const paymentStatuses = Object.values(PaymentStatus) as [PaymentStatus, ...PaymentStatus[]];
const refundStatuses = Object.values(RefundStatus) as [RefundStatus, ...RefundStatus[]];

/** Money in requests: positive whole cents as a string (never a float). */
// Zod runs refinements even after the format check fails, so guard before BigInt().
export const PositiveCentsSchema = CentsStringSchema.refine(
  (v) => /^\d+$/.test(v) && BigInt(v) > 0n,
  'Enter an amount greater than zero',
);

const ReferenceSchema = z.string().trim().min(3, 'Enter the transaction or slip number').max(64);

// ─── Requests ────────────────────────────────────────────────────────────────

export const SubmitManualPaymentRequestSchema = z
  .strictObject({
    channel: z.enum(['MOBILE_MONEY', 'BANK']),
    /** Mobile money: one of MobileMoneyProviders. Bank: the bank's name. */
    provider: z.string().trim().min(2).max(60),
    reference: ReferenceSchema,
    amountCents: PositiveCentsSchema,
    paidAt: z.iso.date('Use the format YYYY-MM-DD'),
    evidenceDocumentId: z.uuid().optional(),
  })
  .refine(
    (v) =>
      v.channel !== 'MOBILE_MONEY' ||
      (MobileMoneyProviders as readonly string[]).includes(v.provider),
    {
      message: 'Choose a mobile money provider',
      path: ['provider'],
    },
  );
export type SubmitManualPaymentRequest = z.infer<typeof SubmitManualPaymentRequestSchema>;

export const RecordCashPaymentRequestSchema = z.strictObject({
  referenceNo: z.string().regex(/^GS-\d{4}-\d{6,}$/, 'Enter a reference like GS-2026-000123'),
  amountCents: PositiveCentsSchema,
  receiptBookRef: ReferenceSchema,
  payerName: z.string().trim().min(2).max(120),
});
export type RecordCashPaymentRequest = z.infer<typeof RecordCashPaymentRequestSchema>;

export const RejectPaymentRequestSchema = z.strictObject({
  reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/),
  note: z.string().trim().min(5, 'Explain the reason in a few words').max(500),
});
export type RejectPaymentRequest = z.infer<typeof RejectPaymentRequestSchema>;

export const RequestRefundRequestSchema = z.strictObject({
  reason: z.enum(RefundReasons),
  amountCents: PositiveCentsSchema,
  note: z.string().trim().max(500).optional(),
});
export type RequestRefundRequest = z.infer<typeof RequestRefundRequestSchema>;

export const DeclineRefundRequestSchema = z.strictObject({
  note: z.string().trim().min(5).max(500),
});
export const CompleteRefundRequestSchema = z.strictObject({
  payoutMethod: z.enum(PayoutMethods),
  payoutReference: ReferenceSchema,
});
export type CompleteRefundRequest = z.infer<typeof CompleteRefundRequestSchema>;

// ─── Responses ───────────────────────────────────────────────────────────────

export const PaymentSchema = z.object({
  id: z.uuid(),
  applicationId: z.uuid(),
  channel: z.enum(PaymentChannels),
  provider: z.string(),
  reference: z.string(),
  amountCents: z.string(),
  overpaidCents: z.string(),
  refundedCents: z.string(),
  paidAt: z.iso.datetime(),
  status: z.enum(paymentStatuses),
  rejectNote: z.string().nullable(),
  receiptNo: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type PaymentDto = z.infer<typeof PaymentSchema>;

export const StaffPaymentSchema = PaymentSchema.extend({
  applicationReferenceNo: z.string().nullable(),
  serviceName: z.string(),
  applicantName: z.string(),
  assessedCents: z.string(),
  evidenceDocumentId: z.uuid().nullable(),
  firstConfirmedById: z.uuid().nullable(),
  payerName: z.string().nullable(),
});
export type StaffPaymentDto = z.infer<typeof StaffPaymentSchema>;

export const CardCheckoutSchema = z.object({ paymentId: z.uuid(), checkoutUrl: z.url() });
export type CardCheckout = z.infer<typeof CardCheckoutSchema>;

export const RefundSchema = z.object({
  id: z.uuid(),
  paymentId: z.uuid(),
  applicationReferenceNo: z.string().nullable(),
  reason: z.enum(RefundReasons),
  amountCents: z.string(),
  status: z.enum(refundStatuses),
  payoutMethod: z.enum(PayoutMethods).nullable(),
  payoutReference: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type RefundDto = z.infer<typeof RefundSchema>;

export const ApplicationLookupSchema = z.object({
  id: z.uuid(),
  referenceNo: z.string(),
  serviceName: z.string(),
  applicantName: z.string(),
  status: z.string(),
  assessedCents: z.string(),
  paidCents: z.string(),
  balanceCents: z.string(),
});
export type ApplicationLookup = z.infer<typeof ApplicationLookupSchema>;

// ─── Receipts and verification (ADR-0006) ───────────────────────────────────

/** Signed receipt payload: strings only, so canonical JSON (RFC 8785) is sorted-key JSON. */
export const ReceiptPayloadSchema = z.strictObject({
  t: z.literal('RCPT'),
  no: z.string(),
  svc: z.string(),
  iss: z.iso.datetime(),
  h: z.string(),
  amt: z.string(),
  kid: z.string(),
});
export type ReceiptPayload = z.infer<typeof ReceiptPayloadSchema>;

export const ReceiptStatuses = ['VALID', 'REFUNDED', 'REVERSED'] as const;

export const PublicReceiptSchema = z.object({
  receiptNo: z.string(),
  serviceName: z.string(),
  amountCents: z.string(),
  issuedAt: z.iso.datetime(),
  status: z.enum(ReceiptStatuses),
  payload: ReceiptPayloadSchema,
});
export type PublicReceipt = z.infer<typeof PublicReceiptSchema>;

export const PublicKeysSchema = z.object({
  keys: z.array(
    z.object({
      kid: z.string(),
      algorithm: z.literal('Ed25519'),
      publicKey: z.string(),
      status: z.enum(['ACTIVE', 'RETIRED']),
    }),
  ),
});
export type PublicKeys = z.infer<typeof PublicKeysSchema>;

/**
 * RFC 8785 (JCS) for flat objects whose values are all strings: keys sorted by UTF-16 code
 * units, JSON string escaping. Receipt and certificate payloads only ever contain strings.
 */
export function canonicalize(payload: Record<string, string>): string {
  const keys = Object.keys(payload).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(payload[k])}`).join(',')}}`;
}

/** "Amina Hassan Warsame" → "Amina H*** W***" (public pages never show full names). */
export function maskName(fullName: string): string {
  const [first = '', ...rest] = fullName.trim().split(/\s+/);
  return [first, ...rest.map((part) => `${part.charAt(0).toUpperCase()}***`)].join(' ');
}

export function base64UrlToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export type SignatureCheck = 'VALID' | 'INVALID' | 'UNSUPPORTED';

/**
 * Verifies an Ed25519 signature over the canonical payload with WebCrypto. Works in Node and
 * in browsers; returns UNSUPPORTED where the browser lacks Ed25519.
 * `publicKeyRaw` is the 32-byte raw key, base64url.
 */
export async function verifySignature(
  payload: Record<string, string>,
  signatureB64Url: string,
  publicKeyRaw: string,
): Promise<SignatureCheck> {
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!subtle) return 'UNSUPPORTED';
  let key: CryptoKey;
  try {
    key = await subtle.importKey(
      'raw',
      base64UrlToBytes(publicKeyRaw),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
  } catch {
    return 'UNSUPPORTED';
  }
  try {
    const data = new TextEncoder().encode(canonicalize(payload));
    const ok = await subtle.verify(
      { name: 'Ed25519' },
      key,
      base64UrlToBytes(signatureB64Url),
      data,
    );
    return ok ? 'VALID' : 'INVALID';
  } catch {
    return 'INVALID';
  }
}
