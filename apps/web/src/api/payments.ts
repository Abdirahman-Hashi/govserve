import {
  ApplicationLookupSchema,
  CardCheckoutSchema,
  type CompleteRefundRequest,
  PaymentSchema,
  PublicKeysSchema,
  PublicReceiptSchema,
  ReasonCodeSchema,
  type RecordCashPaymentRequest,
  RefundSchema,
  type RejectPaymentRequest,
  type RequestEvidenceUploadRequest,
  type RequestRefundRequest,
  StaffPaymentSchema,
  type SubmitManualPaymentRequest,
  UploadTicketSchema,
  DownloadTicketSchema,
} from '@govserve/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { getAccessToken } from '../auth/session-store';
import { api, ApiError } from './client';

const appKey = (id: string) => ['applications', id] as const;

// ─── Citizen ─────────────────────────────────────────────────────────────────

export function useSubmitManualPayment(applicationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SubmitManualPaymentRequest) =>
      api(`/api/v1/applications/${applicationId}/payments`, {
        method: 'POST',
        body,
        schema: PaymentSchema,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: appKey(applicationId) }),
  });
}

/** Card checkout. The idempotency key is per click, so a retried request never starts a second payment. */
export function startCardPayment(applicationId: string, idempotencyKey: string) {
  return fetchJson(`/api/v1/applications/${applicationId}/payments/card`, CardCheckoutSchema, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export function requestEvidenceUpload(applicationId: string, body: RequestEvidenceUploadRequest) {
  return api(`/api/v1/applications/${applicationId}/payment-evidence`, {
    method: 'POST',
    body,
    schema: UploadTicketSchema,
  });
}

/** Downloads a receipt PDF (authenticated) and saves it via an object URL. */
export async function downloadReceipt(paymentId: string, receiptNo: string): Promise<void> {
  const res = await fetch(`/api/v1/payments/${paymentId}/receipt.pdf`, {
    headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
    credentials: 'include',
  });
  if (!res.ok)
    throw new ApiError(res.status, `HTTP_${res.status}`, 'Could not download the receipt');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `${receiptNo}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ─── Staff ───────────────────────────────────────────────────────────────────

export function useStaffPayments(status?: string) {
  return useQuery({
    queryKey: ['staff', 'payments', status ?? 'queue'],
    queryFn: ({ signal }) =>
      api(`/api/v1/staff/payments${status ? `?status=${status}` : ''}`, {
        schema: z.array(StaffPaymentSchema),
        signal,
      }),
  });
}

export function useStaffPayment(id: string) {
  return useQuery({
    queryKey: ['staff', 'payments', 'detail', id],
    queryFn: ({ signal }) =>
      api(`/api/v1/staff/payments/${id}`, { schema: StaffPaymentSchema, signal }),
  });
}

function useStaffMutation<T, R>(fn: (input: T) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staff'] }),
  });
}

export const useConfirmPayment = () =>
  useStaffMutation((id: string) =>
    api(`/api/v1/staff/payments/${id}/confirm`, { method: 'POST', schema: StaffPaymentSchema }),
  );

export const useRejectPayment = () =>
  useStaffMutation(({ id, ...body }: RejectPaymentRequest & { id: string }) =>
    api(`/api/v1/staff/payments/${id}/reject`, {
      method: 'POST',
      body,
      schema: StaffPaymentSchema,
    }),
  );

export const useRecordCash = () =>
  useStaffMutation((body: RecordCashPaymentRequest) =>
    api('/api/v1/staff/payments/cash', { method: 'POST', body, schema: StaffPaymentSchema }),
  );

export function lookupApplication(referenceNo: string) {
  return api(`/api/v1/staff/applications/by-reference/${encodeURIComponent(referenceNo)}`, {
    schema: ApplicationLookupSchema,
  });
}

export function staffDocumentTicket(documentId: string) {
  return api(`/api/v1/staff/documents/${documentId}/download`, { schema: DownloadTicketSchema });
}

export function useStaffReasonCodes(kind: string) {
  return useQuery({
    queryKey: ['staff', 'reason-codes', kind],
    queryFn: ({ signal }) =>
      api(`/api/v1/staff/reason-codes?kind=${kind}`, { schema: z.array(ReasonCodeSchema), signal }),
    staleTime: 10 * 60_000,
  });
}

export function useRefunds(status?: string) {
  return useQuery({
    queryKey: ['staff', 'refunds', status ?? 'all'],
    queryFn: ({ signal }) =>
      api(`/api/v1/staff/refunds${status ? `?status=${status}` : ''}`, {
        schema: z.array(RefundSchema),
        signal,
      }),
  });
}

export const useRequestRefund = () =>
  useStaffMutation(({ paymentId, ...body }: RequestRefundRequest & { paymentId: string }) =>
    api(`/api/v1/staff/payments/${paymentId}/refunds`, {
      method: 'POST',
      body,
      schema: RefundSchema,
    }),
  );

export const useRefundAction = () =>
  useStaffMutation(
    ({
      id,
      action,
      body,
    }: {
      id: string;
      action: 'approve' | 'decline' | 'complete' | 'retry';
      body?: { note: string } | CompleteRefundRequest;
    }) =>
      api(`/api/v1/staff/refunds/${id}/${action}`, {
        method: 'POST',
        ...(body && { body }),
        schema: RefundSchema,
      }),
  );

// ─── Public verification ────────────────────────────────────────────────────

export function usePublicReceipt(receiptNo: string) {
  return useQuery({
    queryKey: ['verify', 'receipt', receiptNo],
    queryFn: ({ signal }) =>
      api(`/api/v1/verify/r/${encodeURIComponent(receiptNo)}`, {
        schema: PublicReceiptSchema,
        signal,
      }),
    retry: false,
  });
}

export function usePublicKeys() {
  return useQuery({
    queryKey: ['verify', 'keys'],
    queryFn: ({ signal }) => api('/api/v1/verify/keys', { schema: PublicKeysSchema, signal }),
    staleTime: 60 * 60_000,
  });
}

/** Like api() but with extra headers (used for Idempotency-Key). */
async function fetchJson<S extends z.ZodType>(
  path: string,
  schema: S,
  init: { method: string; headers: Record<string, string> },
): Promise<z.infer<S>> {
  const res = await fetch(path, {
    method: init.method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${getAccessToken() ?? ''}`,
      ...init.headers,
    },
    credentials: 'include',
  });
  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? `HTTP_${res.status}`,
      err?.message ?? res.statusText,
    );
  }
  return schema.parse(body);
}
