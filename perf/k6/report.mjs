// Per-endpoint latency from k6's raw output: node perf/k6/report.mjs perf/k6/results/<run>/raw.json.gz
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

const file = process.argv[2];
if (!file) throw new Error('usage: node perf/k6/report.mjs <raw.json.gz>');
const byName = new Map();
const lines = createInterface({ input: createReadStream(file).pipe(createGunzip()) });
for await (const line of lines) {
  if (!line.includes('"http_req_duration"') || !line.includes('"Point"')) continue;
  const { data } = JSON.parse(line);
  const name = data.tags.name ?? data.tags.url;
  if (name === 'setup') continue;
  const row = byName.get(name) ?? { kind: data.tags.kind ?? '', ms: [], errors: 0 };
  row.ms.push(data.value);
  if (data.tags.expected_response === 'false') row.errors += 1;
  byName.set(name, row);
}
const pct = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
const rows = [...byName.entries()]
  .map(([name, r]) => {
    const s = r.ms.sort((a, b) => a - b);
    return {
      name,
      kind: r.kind,
      n: s.length,
      p50: pct(s, 50),
      p95: pct(s, 95),
      max: s.at(-1),
      errors: r.errors,
    };
  })
  .sort((a, b) => b.p95 - a.p95);
const f = (v) => v.toFixed(1);
console.log('| Endpoint | Kind | Requests | p50 ms | p95 ms | max ms | Non-2xx |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows)
  console.log(
    `| \`${r.name}\` | ${r.kind} | ${r.n} | ${f(r.p50)} | ${f(r.p95)} | ${f(r.max)} | ${r.errors} |`,
  );
