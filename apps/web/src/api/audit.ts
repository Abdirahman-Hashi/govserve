import { type AuditQuery, AuditPageSchema, AuditVerificationSchema } from '@govserve/shared';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { getAccessToken } from '../auth/session-store';
import { api, ApiError } from './client';
import { reportQuery } from './reports';

export type AuditFilters = Omit<AuditQuery, 'cursor'>;

export function useAuditLog(filters: AuditFilters) {
  return useInfiniteQuery({
    queryKey: ['audit', filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api(`/api/v1/audit${reportQuery(filters as Record<string, string | undefined>, pageParam)}`, {
        schema: AuditPageSchema,
        signal,
      }),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useApplicationAudit(applicationId: string) {
  return useQuery({
    queryKey: ['audit', 'application', applicationId],
    queryFn: ({ signal }) =>
      api(`/api/v1/audit/applications/${applicationId}`, { schema: AuditPageSchema, signal }),
  });
}

export function useVerifyAudit() {
  return useMutation({
    mutationFn: () =>
      api('/api/v1/audit/verify', { method: 'POST', schema: AuditVerificationSchema }),
  });
}

/** CSV export of the filtered trail (the API audits the export itself). */
export async function downloadAudit(filters: AuditFilters): Promise<void> {
  const res = await fetch(`/api/v1/audit/export.csv${reportQuery(filters)}`, {
    headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
    credentials: 'include',
  });
  if (!res.ok) throw new ApiError(res.status, `HTTP_${res.status}`, 'The export failed');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download =
    /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'audit.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
