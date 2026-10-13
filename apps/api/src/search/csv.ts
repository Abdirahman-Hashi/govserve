/** One CSV field: quoted when needed; spreadsheet formulas are neutralised (CSV injection). */
export function csvField(value: string | number | bigint | null | undefined): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n']/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(values: (string | number | bigint | null | undefined)[]): string {
  return `${values.map(csvField).join(',')}\r\n`;
}
