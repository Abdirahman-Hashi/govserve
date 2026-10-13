import {
  type CollectionsReport,
  CollectionsReportSchema,
  MovementsPageSchema,
  PendingWorkReportSchema,
  ReportApplicationsPageSchema,
  type ReportDataset,
  type ReportFilters,
  ReportSummarySchema,
  VolumesReportSchema,
} from '@govserve/shared';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getAccessToken } from '../auth/session-store';
import { api, ApiError } from './client';

/** Report filters hold no personal data, so they travel as query parameters. */
export type ReportParams = ReportFilters & Record<string, string | undefined>;

export function reportQuery(
  params: Record<string, string | undefined>,
  cursor?: string | null,
): string {
  const p = new URLSearchParams(
    Object.entries({ ...params, ...(cursor && { cursor }) }).filter(
      (e): e is [string, string] => typeof e[1] === 'string' && e[1] !== '',
    ),
  );
  const s = p.toString();
  return s ? `?${s}` : '';
}

const opts = { placeholderData: keepPreviousData } as const;

export const useReportSummary = (f: ReportParams) =>
  useQuery({
    queryKey: ['reports', 'summary', f],
    queryFn: ({ signal }) =>
      api(`/api/v1/reports/summary${reportQuery(f)}`, { schema: ReportSummarySchema, signal }),
    ...opts,
  });

export const useCollections = (f: ReportParams, groupBy: CollectionsReport['groupBy']) =>
  useQuery({
    queryKey: ['reports', 'collections', groupBy, f],
    queryFn: ({ signal }) =>
      api(`/api/v1/reports/collections${reportQuery({ ...f, groupBy })}`, {
        schema: CollectionsReportSchema,
        signal,
      }),
    ...opts,
  });

export const useVolumes = (f: ReportParams) =>
  useQuery({
    queryKey: ['reports', 'volumes', f],
    queryFn: ({ signal }) =>
      api(`/api/v1/reports/volumes${reportQuery(f)}`, { schema: VolumesReportSchema, signal }),
    ...opts,
  });

export const usePendingWork = (f: ReportParams) =>
  useQuery({
    queryKey: ['reports', 'pending', f],
    queryFn: ({ signal }) =>
      api(`/api/v1/reports/pending-work${reportQuery(f)}`, {
        schema: PendingWorkReportSchema,
        signal,
      }),
    ...opts,
  });

export const useMovements = (f: Record<string, string | undefined>) =>
  useInfiniteQuery({
    queryKey: ['reports', 'movements', f],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api(`/api/v1/reports/movements${reportQuery(f, pageParam)}`, {
        schema: MovementsPageSchema,
        signal,
      }),
    getNextPageParam: (last) => last.nextCursor,
  });

export const useReportApplications = (f: Record<string, string | undefined>) =>
  useInfiniteQuery({
    queryKey: ['reports', 'applications', f],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api(`/api/v1/reports/applications${reportQuery(f, pageParam)}`, {
        schema: ReportApplicationsPageSchema,
        signal,
      }),
    getNextPageParam: (last) => last.nextCursor,
  });

/** CSV export (audited by the API). */
export async function downloadReport(
  dataset: ReportDataset,
  params: Record<string, string | undefined>,
) {
  const res = await fetch(`/api/v1/reports/export/${dataset}.csv${reportQuery(params)}`, {
    headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
    credentials: 'include',
  });
  if (!res.ok) throw new ApiError(res.status, `HTTP_${res.status}`, 'The export failed');
  const name =
    /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ??
    `${dataset}.csv`;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
