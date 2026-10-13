import { HealthResponseSchema } from '@govserve/shared';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from './client';

/** Readiness of the API; 503 still carries a valid HealthResponse body. */
export function useServiceStatus() {
  return useQuery({
    queryKey: ['ready'],
    queryFn: ({ signal }) =>
      apiGet('/ready', HealthResponseSchema, { allowStatuses: [503], signal }),
    refetchInterval: 60_000,
  });
}
