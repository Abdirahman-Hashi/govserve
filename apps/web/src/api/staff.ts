import {
  type InviteStaffRequest,
  StaffInvitationResponseSchema,
  StaffMemberSchema,
  type UpdateStaffRequest,
} from '@govserve/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from './client';

const staffKey = ['staff'] as const;

export function useStaff() {
  return useQuery({
    queryKey: staffKey,
    queryFn: ({ signal }) => api('/api/v1/staff', { schema: z.array(StaffMemberSchema), signal }),
  });
}

export function useInviteStaff() {
  return useMutation({
    mutationFn: (body: InviteStaffRequest) =>
      api('/api/v1/staff/invitations', {
        method: 'POST',
        body,
        schema: StaffInvitationResponseSchema,
      }),
  });
}

export function useUpdateStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateStaffRequest & { id: string }) =>
      api(`/api/v1/staff/${id}`, { method: 'PATCH', body, schema: StaffMemberSchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: staffKey }),
  });
}

export function useDeactivateStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/api/v1/staff/${id}/deactivate`, { method: 'POST', schema: StaffMemberSchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: staffKey }),
  });
}
