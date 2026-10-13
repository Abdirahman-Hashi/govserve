import {
  ApplicationPageSchema,
  type MyApplicationsQuery,
  type MyPaymentsQuery,
  PaymentHistoryPageSchema,
  type StaffApplicationSearch,
  StaffApplicationResultsSchema,
  type StaffPaymentSearch,
  StaffPaymentResultsSchema,
} from '@govserve/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { getAccessToken } from '../auth/session-store';
import { api, ApiError } from './client';

type Filters<T> = Omit<T, 'cursor'>;

/** Only filled-in filters go to the API. */
function clean<T extends object>(filters: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(filters).filter(([, v]) => v !== undefined && v !== ''),
  ) as Partial<T>;
}

function query(filters: object, cursor: string | null): string {
  const params = new URLSearchParams(clean({ ...filters, ...(cursor && { cursor }) }));
  const s = params.toString();
  return s ? `?${s}` : '';
}

// ─── Citizen history (GET: no personal data in these filters) ──────────────

export function useMyApplications(filters: Filters<MyApplicationsQuery> = {}) {
  return useInfiniteQuery({
    queryKey: ['applications', 'mine', clean(filters)],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api(`/api/v1/applications${query(filters, pageParam)}`, {
        schema: ApplicationPageSchema,
        signal,
      }),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useMyPayments(filters: Filters<MyPaymentsQuery> = {}) {
  return useInfiniteQuery({
    queryKey: ['payments', 'mine', clean(filters)],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api(`/api/v1/payments${query(filters, pageParam)}`, {
        schema: PaymentHistoryPageSchema,
        signal,
      }),
    getNextPageParam: (last) => last.nextCursor,
  });
}

// ─── Staff search (POST: IDs, phones and names never go in a URL) ──────────

export function useStaffApplicationSearch(filters: Filters<StaffApplicationSearch> | null) {
  return useInfiniteQuery({
    queryKey: ['search', 'applications', filters && clean(filters)],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api('/api/v1/search/applications', {
        method: 'POST',
        body: { ...clean(filters ?? {}), ...(pageParam && { cursor: pageParam }) },
        schema: StaffApplicationResultsSchema,
        signal,
      }),
    getNextPageParam: (last) => last.nextCursor,
    enabled: filters !== null,
  });
}

export function useStaffPaymentSearch(filters: Filters<StaffPaymentSearch> | null) {
  return useInfiniteQuery({
    queryKey: ['search', 'payments', filters && clean(filters)],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api('/api/v1/search/payments', {
        method: 'POST',
        body: { ...clean(filters ?? {}), ...(pageParam && { cursor: pageParam }) },
        schema: StaffPaymentResultsSchema,
        signal,
      }),
    getNextPageParam: (last) => last.nextCursor,
    enabled: filters !== null,
  });
}

/** Supervisors: downloads the CSV export (streamed by the API, audited there). */
export async function downloadSearchCsv(
  kind: 'applications' | 'payments',
  filters: object,
): Promise<void> {
  const res = await fetch(`/api/v1/search/${kind}.csv`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getAccessToken() ?? ''}`,
    },
    credentials: 'include',
    body: JSON.stringify(clean(filters)),
  });
  if (!res.ok) throw new ApiError(res.status, `HTTP_${res.status}`, 'The export failed');
  const name =
    /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? `${kind}.csv`;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
