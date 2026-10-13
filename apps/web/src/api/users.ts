import {
  type ChangeEmailRequest,
  ProfileSchema,
  type UpdateProfileRequest,
} from '@govserve/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

const meKey = ['users', 'me'] as const;

export function useMyProfile() {
  return useQuery({
    queryKey: meKey,
    queryFn: ({ signal }) => api('/api/v1/users/me', { schema: ProfileSchema, signal }),
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProfileRequest) =>
      api('/api/v1/users/me', { method: 'PATCH', body, schema: ProfileSchema }),
    onSuccess: (profile) => queryClient.setQueryData(meKey, profile),
  });
}

export function useRequestEmailChange() {
  return useMutation({
    mutationFn: (body: ChangeEmailRequest) =>
      api('/api/v1/users/me/email', { method: 'POST', body }),
  });
}

export function useConfirmEmailChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      api('/api/v1/users/me/email/confirm', {
        method: 'POST',
        body: { code },
        schema: ProfileSchema,
      }),
    onSuccess: (profile) => queryClient.setQueryData(meKey, profile),
  });
}
