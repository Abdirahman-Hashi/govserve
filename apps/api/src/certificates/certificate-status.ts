import { type Certificate } from '../generated/prisma/client';

/** EXPIRED is derived from the date, never stored (STATE_MACHINES §3). */
export function certificateStatus(
  c: Pick<Certificate, 'status' | 'expiresAt'>,
  now = new Date(),
): 'VALID' | 'EXPIRED' | 'REVOKED' {
  if (c.status === 'REVOKED') return 'REVOKED';
  return c.expiresAt && c.expiresAt <= now ? 'EXPIRED' : 'VALID';
}
