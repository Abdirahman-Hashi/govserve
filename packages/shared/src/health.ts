import { z } from 'zod';

/** Response of GET /health and GET /ready, shared by api and web. */
export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
  checks: z.record(z.string(), z.enum(['up', 'down'])).optional(),
  version: z.string(),
  time: z.iso.datetime(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
