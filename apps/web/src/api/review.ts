import {
  type QueueQuery,
  QueueItemSchema,
  StaffApplicationSchema,
  type StaffApplication,
  UnmaskedSchema,
} from '@govserve/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from './client';

const queueKey = ['review', 'queue'] as const;
const detailKey = (id: string) => ['review', 'application', id] as const;

export function useReviewQueue(q: QueueQuery) {
  const params = new URLSearchParams(
    Object.entries(q).filter((e): e is [string, string] => typeof e[1] === 'string'),
  );
  return useQuery({
    queryKey: [...queueKey, params.toString()],
    queryFn: ({ signal }) =>
      api(`/api/v1/review/queue?${params.toString()}`, {
        schema: z.array(QueueItemSchema),
        signal,
      }),
  });
}

export function useStaffApplication(id: string) {
  return useQuery({
    queryKey: detailKey(id),
    queryFn: ({ signal }) =>
      api(`/api/v1/review/applications/${id}`, { schema: StaffApplicationSchema, signal }),
  });
}

export function useClaimNext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api('/api/v1/review/claim-next', { method: 'POST', schema: StaffApplicationSchema }),
    onSuccess: (app) => {
      qc.setQueryData(detailKey(app.id), app);
      return qc.invalidateQueries({ queryKey: queueKey });
    },
  });
}

/** Paths under /review/applications/:id that take a body with the version and return the application. */
export type ReviewActionPath =
  | 'claim'
  | 'release'
  | 'assign'
  | 'corrections'
  | 'appointment'
  | 'appointment/outcome'
  | 'approve'
  | 'refer'
  | 'reject'
  | 'second-approve'
  | 'confirm-referral'
  | 'return'
  | 'chargeback';

export function useReviewAction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body }: { path: ReviewActionPath; body: { version: number } & object }) =>
      api(`/api/v1/review/applications/${id}/${path}`, {
        method: 'POST',
        body,
        schema: StaffApplicationSchema,
      }),
    onSuccess: (app: StaffApplication) => {
      qc.setQueryData(detailKey(id), app);
      return qc.invalidateQueries({ queryKey: queueKey });
    },
    // A concurrent change: reload so the officer sees the current state.
    onError: () => qc.invalidateQueries({ queryKey: detailKey(id) }),
  });
}

export function unmaskApplication(id: string) {
  return api(`/api/v1/review/applications/${id}/unmask`, {
    method: 'POST',
    schema: UnmaskedSchema,
  });
}
