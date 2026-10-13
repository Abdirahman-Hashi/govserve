import { BadRequestException } from '@nestjs/common';

/** Keyset position: rows are ordered by (createdAt DESC, id DESC); the id breaks ties. */
export interface Position {
  createdAt: Date;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function encodeCursor(p: Position): string {
  return Buffer.from(`${p.createdAt.toISOString()}|${p.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | undefined): Position | null {
  if (!cursor) return null;
  const [iso = '', id = ''] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(iso);
  if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== iso || !UUID.test(id)) {
    throw new BadRequestException({
      code: 'INVALID_CURSOR',
      message: 'The page link is not valid. Start the search again.',
    });
  }
  return { createdAt, id };
}

/** Takes one extra row to know whether there is a next page. */
export function page<T extends Position, R>(rows: T[], size: number, map: (row: T) => R) {
  const items = rows.slice(0, size);
  const last = items[items.length - 1];
  return {
    items: items.map(map),
    nextCursor: rows.length > size && last ? encodeCursor(last) : null,
  };
}
