import {
  AdminServiceSchema,
  CatalogueServiceDetailSchema,
  CatalogueServiceSummarySchema,
  type CreateHolidayRequest,
  type CreateReasonCodeRequest,
  type CreateServiceRequest,
  HolidaySchema,
  ReasonCodeSchema,
  ServiceVersionSchema,
  SettingSchema,
  type UpdateReasonCodeRequest,
  type UpdateServiceRequest,
  type UpdateVersionRequest,
} from '@govserve/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from './client';

// ─── Public catalogue ────────────────────────────────────────────────────────

export function useCatalogue(q: string) {
  return useQuery({
    queryKey: ['catalogue', q],
    queryFn: ({ signal }) =>
      api(`/api/v1/catalogue/services${q ? `?q=${encodeURIComponent(q)}` : ''}`, {
        schema: z.array(CatalogueServiceSummarySchema),
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useCatalogueService(code: string) {
  return useQuery({
    queryKey: ['catalogue', 'detail', code],
    queryFn: ({ signal }) =>
      api(`/api/v1/catalogue/services/${encodeURIComponent(code)}`, {
        schema: CatalogueServiceDetailSchema,
        signal,
      }),
  });
}

// ─── Admin: services and versions ────────────────────────────────────────────

const servicesKey = ['admin', 'services'] as const;
const versionsKey = (serviceId: string) => ['admin', 'services', serviceId, 'versions'] as const;

export function useAdminServices() {
  return useQuery({
    queryKey: servicesKey,
    queryFn: ({ signal }) =>
      api('/api/v1/admin/services', { schema: z.array(AdminServiceSchema), signal }),
  });
}

export function useCreateService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateServiceRequest) =>
      api('/api/v1/admin/services', { method: 'POST', body, schema: AdminServiceSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: servicesKey }),
  });
}

export function useUpdateService(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateServiceRequest) =>
      api(`/api/v1/admin/services/${id}`, { method: 'PATCH', body, schema: AdminServiceSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: servicesKey }),
  });
}

export function useServiceVersions(serviceId: string) {
  return useQuery({
    queryKey: versionsKey(serviceId),
    queryFn: ({ signal }) =>
      api(`/api/v1/admin/services/${serviceId}/versions`, {
        schema: z.array(ServiceVersionSchema),
        signal,
      }),
  });
}

export function useVersion(id: string) {
  return useQuery({
    queryKey: ['admin', 'versions', id],
    queryFn: ({ signal }) =>
      api(`/api/v1/admin/versions/${id}`, { schema: ServiceVersionSchema, signal }),
  });
}

/** Invalidate everything that shows version state after a change. */
function useVersionInvalidation() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['admin'] }),
      qc.invalidateQueries({ queryKey: ['catalogue'] }),
    ]);
}

export function useCreateDraft(serviceId: string) {
  const invalidate = useVersionInvalidation();
  return useMutation({
    mutationFn: () =>
      api(`/api/v1/admin/services/${serviceId}/versions`, {
        method: 'POST',
        schema: ServiceVersionSchema,
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateDraft(id: string) {
  const invalidate = useVersionInvalidation();
  return useMutation({
    mutationFn: (body: UpdateVersionRequest) =>
      api(`/api/v1/admin/versions/${id}`, { method: 'PATCH', body, schema: ServiceVersionSchema }),
    onSuccess: invalidate,
  });
}

export function useDeleteDraft(id: string) {
  const invalidate = useVersionInvalidation();
  return useMutation({
    mutationFn: () => api(`/api/v1/admin/versions/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function usePublishVersion(id: string) {
  const invalidate = useVersionInvalidation();
  return useMutation({
    mutationFn: () =>
      api(`/api/v1/admin/versions/${id}/publish`, { method: 'POST', schema: ServiceVersionSchema }),
    onSuccess: invalidate,
  });
}

export function useRetireVersion(id: string) {
  const invalidate = useVersionInvalidation();
  return useMutation({
    mutationFn: () =>
      api(`/api/v1/admin/versions/${id}/retire`, { method: 'POST', schema: ServiceVersionSchema }),
    onSuccess: invalidate,
  });
}

// ─── Admin: settings, holidays, reason codes ────────────────────────────────

export function useSettings() {
  return useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: ({ signal }) =>
      api('/api/v1/admin/settings', { schema: z.array(SettingSchema), signal }),
  });
}

export function useUpdateSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      api(`/api/v1/admin/settings/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: { value },
        schema: SettingSchema,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'settings'] }),
  });
}

export function useHolidays() {
  return useQuery({
    queryKey: ['admin', 'holidays'],
    queryFn: ({ signal }) =>
      api('/api/v1/admin/holidays', { schema: z.array(HolidaySchema), signal }),
  });
}

export function useAddHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateHolidayRequest) =>
      api('/api/v1/admin/holidays', { method: 'POST', body, schema: HolidaySchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'holidays'] }),
  });
}

export function useRemoveHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (date: string) => api(`/api/v1/admin/holidays/${date}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'holidays'] }),
  });
}

export function useReasonCodes() {
  return useQuery({
    queryKey: ['admin', 'reason-codes'],
    queryFn: ({ signal }) =>
      api('/api/v1/admin/reason-codes', { schema: z.array(ReasonCodeSchema), signal }),
  });
}

export function useCreateReasonCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateReasonCodeRequest) =>
      api('/api/v1/admin/reason-codes', { method: 'POST', body, schema: ReasonCodeSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'reason-codes'] }),
  });
}

export function useUpdateReasonCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateReasonCodeRequest & { id: string }) =>
      api(`/api/v1/admin/reason-codes/${id}`, { method: 'PATCH', body, schema: ReasonCodeSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'reason-codes'] }),
  });
}
