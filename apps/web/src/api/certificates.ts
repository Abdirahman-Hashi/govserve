import {
  CertificateSummarySchema,
  NameCheckResponseSchema,
  PublicCertificateSchema,
  type RevokeCertificateRequest,
} from '@govserve/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { getAccessToken } from '../auth/session-store';
import { api, ApiError } from './client';

const mineKey = ['certificates'] as const;

export function useMyCertificates() {
  return useQuery({
    queryKey: mineKey,
    queryFn: ({ signal }) =>
      api('/api/v1/certificates', { schema: z.array(CertificateSummarySchema), signal }),
  });
}

export function useOrderDuplicate(certificateId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (copies: number) =>
      api(`/api/v1/certificates/${certificateId}/duplicates`, {
        method: 'POST',
        body: { copies },
        schema: z.object({ applicationId: z.uuid() }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['applications'] }),
  });
}

export function useRevokeCertificate(certificateId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RevokeCertificateRequest) =>
      api(`/api/v1/certificates/${certificateId}/revoke`, {
        method: 'POST',
        body,
        schema: CertificateSummarySchema,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['review'] }),
  });
}

/** Downloads a certificate PDF (authenticated) and saves it via an object URL. */
export async function downloadCertificate(id: string, certificateNo: string): Promise<void> {
  const res = await fetch(`/api/v1/certificates/${id}/certificate.pdf`, {
    headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
    credentials: 'include',
  });
  if (!res.ok)
    throw new ApiError(res.status, `HTTP_${res.status}`, 'Could not download the certificate');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `${certificateNo}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function usePublicCertificate(certificateNo: string) {
  return useQuery({
    queryKey: ['verify', 'certificate', certificateNo],
    queryFn: ({ signal }) =>
      api(`/api/v1/verify/c/${encodeURIComponent(certificateNo)}`, {
        schema: PublicCertificateSchema,
        signal,
      }),
    retry: false,
  });
}

export function useNameCheck(certificateNo: string) {
  return useMutation({
    mutationFn: (name: string) =>
      api(`/api/v1/verify/c/${encodeURIComponent(certificateNo)}/name-check`, {
        method: 'POST',
        body: { name },
        schema: NameCheckResponseSchema,
      }),
  });
}
