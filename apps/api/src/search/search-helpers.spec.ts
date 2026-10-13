import { BadRequestException } from '@nestjs/common';
import { decodeCursor, encodeCursor, page } from './cursor';
import { csvField, csvRow } from './csv';
import { nameQuery } from './name-query';

const ID = '0199e0a8-7c1b-7d2e-9f00-00000000aaaa';

describe('keyset cursor', () => {
  it('should round-trip the position', () => {
    const at = new Date('2026-10-14T08:00:00.123Z');
    expect(decodeCursor(encodeCursor({ createdAt: at, id: ID }))).toEqual({
      createdAt: at,
      id: ID,
    });
    expect(decodeCursor(undefined)).toBeNull();
  });

  it.each([
    Buffer.from('not-a-date|x').toString('base64url'),
    Buffer.from(`2026-10-14T08:00:00.123Z|${ID}'; DROP TABLE x`).toString('base64url'),
    Buffer.from('2026-10-14|' + ID).toString('base64url'),
  ])('should reject a tampered cursor %s', (cursor) => {
    expect(() => decodeCursor(cursor)).toThrow(BadRequestException);
  });

  it('should report a next page only when an extra row came back', () => {
    const rows = [1, 2, 3].map((n) => ({ createdAt: new Date(n * 1000), id: ID, n }));
    expect(page(rows, 3, (r) => r.n).nextCursor).toBeNull();
    const more = page(rows, 2, (r) => r.n);
    expect(more.items).toEqual([1, 2]);
    expect(decodeCursor(more.nextCursor!)!.createdAt).toEqual(new Date(2000));
  });
});

describe('CSV', () => {
  it('should quote separators, quotes and line breaks', () => {
    expect(csvField('Hodan, Ali')).toBe('"Hodan, Ali"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('a\nb')).toBe('"a\nb"');
    expect(csvField(null)).toBe('');
    expect(csvField(1900n)).toBe('1900');
  });

  it.each(['=HYPERLINK("x")', '+1', '-2+3', '@SUM(A1)'])('should neutralise formula %s', (v) => {
    expect(csvField(v).replace(/^"/, '')).toMatch(/^'/);
  });

  it('should end rows with CRLF', () => {
    expect(csvRow(['a', 'b'])).toBe('a,b\r\n');
  });
});

describe('name query', () => {
  it('should prefix-match every word in any order', () => {
    expect(nameQuery('  Hod ALI ')).toBe('hod:* & ali:*');
  });

  it('should keep only letters and digits, so the tsquery is always valid', () => {
    expect(nameQuery("Ca'diyo & | ! (x)")).toBe('cadiyo:* & x:*');
    expect(nameQuery('Cabdi Xasan Faarax')).toBe('cabdi:* & xasan:* & faarax:*');
    expect(nameQuery('&&& !!')).toBeNull();
  });
});
