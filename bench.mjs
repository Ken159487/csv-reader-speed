import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readCsv } from '/workspace/csvkit/csv-reader-speed-01-run-20261121-kit/baselines/csv-reader/vendor/csv-reader/index.js';
import { run } from '/workspace/csv-reader-speed/solve.js';

const impl = process.argv[2];
if (impl !== 'ref' && impl !== 'cand') { console.error('usage: bench.mjs ref|cand'); process.exit(2); }
const fn = impl === 'ref' ? readCsv : run;
const KIT = '/workspace/csvkit/csv-reader-speed-01-run-20261121-kit';
const cases = JSON.parse(readFileSync(KIT + '/practice/input/cases.json', 'utf8'));
const expectedDoc = JSON.parse(readFileSync(KIT + '/practice/reference/expected.json', 'utf8'));
const expected = expectedDoc.cases.map(function (c) { return c.output; });
function sha(s) { return createHash('sha256').update(s).digest('hex'); }
const expHash = sha(JSON.stringify(expected));
// warm-up round (discarded): JIT + GC settle, same code path as timed round
cases.forEach(function (c) { fn(c.input); });
// timed round: full set, per-case wall times
const perCaseMs = [];
const t0 = performance.now();
const answers = cases.map(function (c) {
  const s = performance.now();
  const a = fn(c.input);
  perCaseMs.push(performance.now() - s);
  return a;
});
const totalMs = performance.now() - t0;
const hash = sha(JSON.stringify(answers));
console.log(JSON.stringify({
  impl: impl,
  totalMs: Math.round(totalMs * 100) / 100,
  perCaseMs: perCaseMs.map(function (x) { return Math.round(x * 100) / 100; }),
  caseIds: cases.map(function (c) { return c.id; }),
  hash: hash,
  expectedHash: expHash,
  matchExpected: hash === expHash,
  rows: answers.map(function (a) { return a.rows.length; }),
  errors: answers.map(function (a) { return a.errors.length; }),
  columns: answers.map(function (a) { return a.columns ? a.columns.length : null; })
}));
