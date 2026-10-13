import {
  type NotificationPreferences,
  NotificationPageSchema,
  NotificationPreferencesSchema,
  UnreadCountSchema,
} from '@govserve/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

const key = ['notifications'] as const;
const prefsKey = ['notification-preferences'] as const;

/** Polled once a minute to keep data use low on mobile networks. */
export function useUnreadCount(enabled: boolean) {
  return useQuery({
    queryKey: [...key, 'unread'],
    queryFn: ({ signal }) =>
      api('/api/v1/notifications/unread-count', { schema: UnreadCountSchema, signal }),
    enabled,
    refetchInterval: 60_000,
  });
}

export function useNotifications() {
  return useInfiniteQuery({
    queryKey: [...key, 'list'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api(`/api/v1/notifications${pageParam ? `?cursor=${pageParam}` : ''}`, {
        schema: NotificationPageSchema,
        signal,
      }),
    getNextPageParam: (last) => last.nextCursor,
  });
}

function useNotificationMutation(fn: (id?: string) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
}

export const useMarkRead = () =>
  useNotificationMutation((id) => api(`/api/v1/notifications/${id}/read`, { method: 'POST' }));

export const useMarkAllRead = () =>
  useNotificationMutation(() => api('/api/v1/notifications/read-all', { method: 'POST' }));

export function useNotificationPreferences() {
  return useQuery({
    queryKey: prefsKey,
    queryFn: ({ signal }) =>
      api('/api/v1/account/notification-preferences', {
        schema: NotificationPreferencesSchema,
        signal,
      }),
  });
}

export function useSetNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NotificationPreferences) =>
      api('/api/v1/account/notification-preferences', {
        method: 'PUT',
        body,
        schema: NotificationPreferencesSchema,
      }),
    onSuccess: (prefs) => qc.setQueryData(prefsKey, prefs),
  });
}
