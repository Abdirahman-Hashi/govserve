/**
 * Identifies a file by its first bytes (magic numbers), never by its name or the type the
 * client declared (FR-035). Only the three formats GovServe accepts are recognised.
 */
export type SniffedMime = 'application/pdf' | 'image/jpeg' | 'image/png';

const SIGNATURES: { mime: SniffedMime; bytes: number[] }[] = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

export const SNIFF_BYTES = 8;

export function sniffMime(head: Uint8Array): SniffedMime | null {
  return SIGNATURES.find((s) => s.bytes.every((b, i) => head[i] === b))?.mime ?? null;
}
