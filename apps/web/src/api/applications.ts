import {
  ApplicationDetailSchema,
  ApplicationSummarySchema,
  DocumentSchema,
  DownloadTicketSchema,
  type RequestUploadRequest,
  type UpdateApplicationRequest,
  UploadTicketSchema,
} from '@govserve/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from './client';

const listKey = ['applications'] as const;
const detailKey = (id: string) => ['applications', id] as const;

export function useMyApplications() {
  return useQuery({
    queryKey: listKey,
    queryFn: ({ signal }) =>
      api('/api/v1/applications', { schema: z.array(ApplicationSummarySchema), signal }),
  });
}

export function useApplication(id: string, opts: { pollWhileAwaitingPayment?: boolean } = {}) {
  return useQuery({
    queryKey: detailKey(id),
    queryFn: ({ signal }) =>
      api(`/api/v1/applications/${id}`, { schema: ApplicationDetailSchema, signal }),
    // After returning from card checkout, poll until the gateway webhook has confirmed it.
    refetchInterval: (q) =>
      opts.pollWhileAwaitingPayment && q.state.data?.status === 'AWAITING_PAYMENT' ? 3000 : false,
  });
}

export function useCreateApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (serviceCode: string) =>
      api('/api/v1/applications', {
        method: 'POST',
        body: { serviceCode },
        schema: ApplicationDetailSchema,
      }),
    onSuccess: (app) => {
      qc.setQueryData(detailKey(app.id), app);
      return qc.invalidateQueries({ queryKey: listKey });
    },
  });
}

/** Autosave: the server's response becomes the cached application. */
export function useSaveApplication(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateApplicationRequest) =>
      api(`/api/v1/applications/${id}`, { method: 'PATCH', body, schema: ApplicationDetailSchema }),
    onSuccess: (app) => qc.setQueryData(detailKey(id), app),
  });
}

function useLifecycle(id: string, action: 'submit' | 'withdraw') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api(`/api/v1/applications/${id}/${action}`, {
        method: 'POST',
        schema: ApplicationDetailSchema,
      }),
    onSuccess: (app) => {
      qc.setQueryData(detailKey(id), app);
      return qc.invalidateQueries({ queryKey: listKey });
    },
  });
}

export const useSubmitApplication = (id: string) => useLifecycle(id, 'submit');
export const useWithdrawApplication = (id: string) => useLifecycle(id, 'withdraw');

export function useDeleteApplication(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/api/v1/applications/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.removeQueries({ queryKey: detailKey(id) });
      return qc.invalidateQueries({ queryKey: listKey });
    },
  });
}

export function useRemoveDocument(applicationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) =>
      api(`/api/v1/documents/${documentId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: detailKey(applicationId) }),
  });
}

export function requestUpload(applicationId: string, body: RequestUploadRequest) {
  return api(`/api/v1/applications/${applicationId}/documents`, {
    method: 'POST',
    body,
    schema: UploadTicketSchema,
  });
}

export function completeUpload(documentId: string) {
  return api(`/api/v1/documents/${documentId}/complete`, {
    method: 'POST',
    schema: DocumentSchema,
  });
}

export function downloadTicket(documentId: string) {
  return api(`/api/v1/documents/${documentId}/download`, { schema: DownloadTicketSchema });
}

export function useInvalidateApplication(id: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: detailKey(id) });
}
