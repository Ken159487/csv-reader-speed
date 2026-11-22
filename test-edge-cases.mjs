// Edge-case test suite for csv-reader-speed-01-run-20261121.
//
// Compares a candidate solve.js against the oracle (csv-reader 1.0.0) on a battery
// of hand-crafted inputs covering every rule in SPEC-CHECKLIST.md, especially the
// 6 ranked correctness traps. Expected outputs are NOT hard-coded: they are the
// oracle's own outputs, so the suite stays faithful to the reference by construction.
//
// Usage:
//   node test-edge-cases.mjs [candidate-solve.js]
//   Default candidate: /workspace/csv-reader-speed/solve.js
//   To verify this harness itself, run it against the oracle's own solve.js:
//   node test-edge-cases.mjs /workspace/csvkit/csv-reader-speed-01-run-20261121-kit/baselines/csv-reader/solve.js
//   (that run MUST pass 100% — if it does not, this harness is wrong, not the oracle.)
//
// Prints PASS/FAIL per case with a diff on failure. Exits 0 only if every case passes.

import { pathToFileURL } from 'node:url';

const CANDIDATE_PATH = process.argv[2] ?? '/workspace/csv-reader-speed/solve.js';
const ORACLE_PATH =
  process.env.ORACLE_PATH ??
  '/workspace/csvkit/csv-reader-speed-01-run-20261121-kit/baselines/csv-reader/vendor/csv-reader/index.js';

// --- deep equality: arrays in order, object keys in any order, primitives strict ---
function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

// First difference, for the failure diff. Returns null when equal.
function findDiff(a, b, path) {
  if (a === b) return null;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return `${path}: expected ${JSON.stringify(a)} but got ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return `${path}: expected ${Array.isArray(a) ? 'array' : 'object'} but got ${Array.isArray(b) ? 'array' : 'object'}`;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) return `${path}: expected length ${a.length} but got ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = findDiff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(a, k)) return `${path}.${k}: unexpected key in candidate, value ${JSON.stringify(b[k])}`;
    if (!Object.prototype.hasOwnProperty.call(b, k)) return `${path}.${k}: missing key in candidate, expected ${JSON.stringify(a[k])}`;
    const d = findDiff(a[k], b[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

// --- cases: { name, input: { text, header } } ---
// `header` may be omitted (then it is undefined, i.e. not true -> no header).
const CASES = [
  // Trap 1 — unterminated quote (SPEC-CHECKLIST.md §4.4, §8 Trap 1)
  { name: 'T1-01 unterminated, single field, EOF', input: { text: '"abc', header: false } },
  { name: 'T1-02 unterminated, commas+LF in span become separators', input: { text: 'a,b\n"x,y\n3,4\n', header: true } },
  { name: 'T1-03 unterminated in middle field', input: { text: 'a,b,c\n1,"xy,2\n3,4,5\n', header: true } },
  { name: 'T1-04 unterminated at end, no trailing break', input: { text: 'a,b\n1,2\n3,"zz', header: true } },
  { name: 'T1-05 unterminated, stray CR inside re-read tail', input: { text: 'a,b\n"x\ry,z\n', header: true } },
  { name: 'T1-06 unterminated, CRLF+LF in span, line reset', input: { text: 'h1,h2\n"a\r\nb\nc,d\n', header: true } },
  { name: 'T1-07 unterminated quote is the header', input: { text: '"a,b\n1,2\n', header: true } },
  { name: 'T1-08 unterminated, quote alone', input: { text: '"', header: false } },
  { name: 'T1-09 unterminated, doubled quotes in span are literal on re-read', input: { text: '"a""b,c\n1,2\n', header: false } },
  { name: 'T1-10 unterminated, generator-style tail records', input: { text: 'a,b,c\n1,2,3\n"4,5,6\n7,8,9\n', header: true } },
  { name: 'T1-11 unterminated, second quote opens after fallback comma', input: { text: '"a,"b', header: false } },
  { name: 'T1-12 unterminated, empty quoted span then EOF', input: { text: 'a,b\n"', header: true } },

  // Trap 2 — quote junk (SPEC-CHECKLIST.md §4.3, §8 Trap 2)
  { name: 'T2-01 junk after closing quote', input: { text: '"a"x,b\n', header: false } },
  { name: 'T2-02 junk containing quotes (literal)', input: { text: '"a"x"y,b\n', header: false } },
  { name: 'T2-03 junk after doubled-quote value', input: { text: '"a""b"z\n', header: false } },
  { name: 'T2-04 junk is only lone CRs: stray_cr, NO quote_junk', input: { text: '"a"\r,b\n', header: false } },
  { name: 'T2-05 junk CR then text: stray_cr BEFORE quote_junk', input: { text: '"a"\rx,b\n', header: false } },
  { name: 'T2-06 junk ending at CRLF', input: { text: '"a"junk\r\nb,c\n', header: false } },
  { name: 'T2-07 junk at EOF', input: { text: '"a"zz', header: false } },
  { name: 'T2-08 junk stops at comma', input: { text: '"a"x,y,b\n', header: false } },
  { name: 'T2-09 junk with doubled quotes', input: { text: '"a"x""y\n', header: false } },
  { name: 'T2-10 no junk: comma right after close', input: { text: '"a",b\n', header: false } },
  { name: 'T2-11 no junk: LF right after close', input: { text: '"a"\nb\n', header: false } },
  { name: 'T2-12 junk is a single space', input: { text: '"a" ,b\n', header: false } },
];

const CASES2 = [
  // Trap 3 — line attribution (SPEC-CHECKLIST.md §2, §8 Trap 3)
  { name: 'T3-01 short_row line is start line after multi-line note', input: { text: 'a,b\n"x\ny",2\n3\n', header: true } },
  { name: 'T3-02 CRLF inside quotes counts once for line attribution', input: { text: 'a,b\r\n"x\r\ny",2\r\n3\r\n', header: true } },
  { name: 'T3-03 lone CR inside quotes counts as a line', input: { text: 'a,b\n"x\ry",2\n3\n', header: true } },
  { name: 'T3-04 stray_cr in later field carries record start line', input: { text: 'a,b\n"x\ny",2\r3\n', header: true } },
  { name: 'T3-05 multi-line header, next record starts on line 3', input: { text: '"h\n1",b\n1\n', header: true } },
  { name: 'T3-06 blank lines before a record shift its line', input: { text: 'a,b\n\n\n1\n', header: true } },
  { name: 'T3-07 blank CRLF lines before a record shift its line', input: { text: 'a,b\r\n\r\n\r\n1\r\n', header: true } },
  { name: 'T3-08 long_row line is record start line after multi-line note', input: { text: 'a,b\n"x\ny",2\n3,4,5\n', header: true } },

  // Trap 4 — stray-CR-only lines (SPEC-CHECKLIST.md §5.3, §8 Trap 4)
  { name: 'T4-01 stray-CR-only line mid-file, no record, error kept', input: { text: 'a,b\n\r\r\n1,2\n', header: true } },
  { name: 'T4-02 stray-CR-only line at EOF', input: { text: 'a,b\n\r', header: true } },
  { name: 'T4-03 lone CR alone, header false', input: { text: '\r', header: false } },
  { name: 'T4-04 stray-CR-only line before header, error row is null', input: { text: '\r\r\na,b\n1,2\n', header: true } },
  { name: 'T4-05 two stray-CR-only lines in a row', input: { text: 'a,b\n\r\r\n\r\r\n1,2\n', header: true } },
  { name: 'T4-06 stray-CR-only line does not set width', input: { text: '\r\r\na,b\n1\n', header: false } },
  { name: 'T4-07 quoted empty field IS a record (contrast)', input: { text: '""\n', header: false } },
  { name: 'T4-08 CR then content is a real record with stray_cr', input: { text: '\rX\n', header: false } },

  // Trap 5 — empty input / header edge (SPEC-CHECKLIST.md §1, §8 Trap 5)
  { name: 'T5-01 empty input, header true -> columns []', input: { text: '', header: true } },
  { name: 'T5-02 empty input, header false -> columns null', input: { text: '', header: false } },
  { name: 'T5-03 BOM only, header true', input: { text: '\uFEFF', header: true } },
  { name: 'T5-04 BOM only, header false', input: { text: '\uFEFF', header: false } },
  { name: 'T5-05 blank lines only, header true', input: { text: '\n\n\n', header: true } },
  { name: 'T5-06 blank CRLF lines only, header true', input: { text: '\r\n\r\n', header: true } },
  { name: 'T5-07 header only, no trailing break', input: { text: 'a,b,c', header: true } },
  { name: 'T5-08 header only, trailing break', input: { text: 'a,b,c\n', header: true } },
  { name: 'T5-09 single record, header false', input: { text: 'a,b,c', header: false } },
  { name: 'T5-10 header sets width for pad and cut', input: { text: 'a,b\n1,2,3\n4\n', header: true } },
  { name: 'T5-11 first record sets width, header false', input: { text: '1,2,3\n4,5\n', header: false } },
  { name: 'T5-12 one-field header, wider row is long_row', input: { text: 'a\n1,2\n', header: true } },

  // Trap 6 — CRLF / lone CR inside vs outside quotes (SPEC-CHECKLIST.md §4, §8 Trap 6)
  { name: 'T6-01 CRLF inside quotes becomes LF', input: { text: '"a\r\nb",c\n', header: false } },
  { name: 'T6-02 lone CR inside quotes becomes LF', input: { text: '"a\rb",c\n', header: false } },
  { name: 'T6-03 lone CR outside quotes dropped + stray_cr', input: { text: 'a\rb,c\n', header: false } },
  { name: 'T6-04 CRLF outside quotes is one line break', input: { text: 'a,b\r\nc,d\r\n', header: false } },
  { name: 'T6-05 lone CR at EOF outside quotes', input: { text: 'a,b\r', header: false } },
  { name: 'T6-06 CRLF inside quotes at field end', input: { text: '"a\r\n",b\n', header: false } },
  { name: 'T6-07 several lone CRs inside quotes', input: { text: '"a\r\r\rb"\n', header: false } },
  { name: 'T6-08 CR CR LF outside quotes: one stray_cr, one break', input: { text: 'a\r\r\nb\n', header: false } },
  { name: 'T6-09a quoted field ends at CRLF', input: { text: '"a"\r\nb\n', header: false } },
  { name: 'T6-09b quoted field ends at LF', input: { text: '"a"\nb\n', header: false } },
  { name: 'T6-10 several LFs inside quotes', input: { text: '"a\nb\nc",d\n', header: false } },
  { name: 'T6-11 CRLF file, header, multi-line CRLF note', input: { text: 'a,b\r\n"x\r\ny",2\r\n3,4\r\n', header: true } },

  // BOM (SPEC-CHECKLIST.md §6)
  { name: 'B-01 BOM + header', input: { text: '\uFEFFa,b\n1,2\n', header: true } },
  { name: 'B-02 BOM, header false', input: { text: '\uFEFFa,b\n', header: false } },
  { name: 'B-03 BOM mid-text is a literal character', input: { text: 'a,b\n\uFEFFx,y\n', header: false } },
  { name: 'B-04 BOM before a quoted first field', input: { text: '\uFEFF"a",b\n', header: false } },
  { name: 'B-05 BOM + blank line only, header true', input: { text: '\uFEFF\n', header: true } },
  { name: 'B-06 second BOM is kept as a field character', input: { text: '\uFEFF\uFEFFa,b\n', header: false } },

  // Blank lines (SPEC-CHECKLIST.md §5.1)
  { name: 'BL-01 blank line at start of file', input: { text: '\na,b\n1,2\n', header: false } },
  { name: 'BL-02 blank line between header and row', input: { text: 'a,b\n\n1,2\n', header: true } },
  { name: 'BL-03 blank CRLF line between rows', input: { text: 'a,b\r\n\r\n1,2\r\n', header: true } },
  { name: 'BL-04 trailing blank lines make no extra record', input: { text: 'a,b\n1,2\n\n\n', header: true } },
  { name: 'BL-05 blank line before a short row', input: { text: 'a,b\n\n1\n', header: true } },

  // Doubled quotes and literal quotes (SPEC-CHECKLIST.md §4.1, §4.2, §6)
  { name: 'D-01 doubled quote inside quoted field', input: { text: '"a""b",c\n', header: false } },
  { name: 'D-02 four quotes is one quote character', input: { text: '""""\n', header: false } },
  { name: 'D-03 empty quoted field', input: { text: '""\n', header: false } },
  { name: 'D-04 doubled quote then close', input: { text: '"a""",b\n', header: false } },
  { name: 'D-05 quotes inside an unquoted field are literal', input: { text: 'a"b"c,d\n', header: false } },
  { name: 'D-06 space before quote: field stays unquoted', input: { text: ' "a",b\n', header: false } },

  // Empty fields and trailing commas (SPEC-CHECKLIST.md §5.4)
  { name: 'E-01 trailing comma gives an empty last field', input: { text: 'a,b,\n', header: false } },
  { name: 'E-02 only commas', input: { text: ',,\n', header: false } },
  { name: 'E-03 single comma', input: { text: ',', header: false } },
  { name: 'E-04 no trailing newline', input: { text: 'a,b', header: false } },
  { name: 'E-05 trailing newline, same as no trailing newline', input: { text: 'a,b\n', header: false } },

  // No trimming, no conversion (SPEC-CHECKLIST.md §1, §6)
  { name: 'N-01 spaces and number-like strings stay strings', input: { text: '  a  ,007,1.0,TRUE\n', header: false } },
  { name: 'N-02 spaces inside quotes are kept', input: { text: '"  x  "\n', header: false } },

  // Error order and short/long detail (SPEC-CHECKLIST.md §3.3, §5.2)
  { name: 'O-01 stray_cr inside junk comes before quote_junk', input: { text: '"a"x\rb\n', header: false } },
  { name: 'O-02 stray_cr comes before short_row of the same record', input: { text: 'a,b,c\n1\rz\n', header: true } },
  { name: 'O-03 quote_junk in row 0, long_row in row 1', input: { text: 'a,b\n"x"y,2\n3,4,5\n', header: true } },
  { name: 'O-04 short_row then long_row, fields and extra exact', input: { text: 'a,b,c\n1,2\n3,4,5,6\n', header: true } },

  // Multi-line notes and quoted commas
  { name: 'M-01 quoted field holding a comma', input: { text: '"a,b",c\n', header: false } },
  { name: 'M-02 quoted field with LF and comma, next record line', input: { text: '"a\nb,c",d\n1,2\n', header: true } },
  { name: 'M-03 two multi-line notes, second with lone CR', input: { text: 'a,b\n"n1\nn2",x\n"m1\rm2",y\n', header: true } },

  // Misc
  { name: 'X-01 non-ASCII kept code unit for code unit', input: { text: 'Zürich,naïve\n', header: false } },
  { name: 'X-02 header key missing means no header', input: { text: 'a,b\n' } },
  { name: 'X-03 non-string text is coerced with String()', input: { text: 123, header: false } },
  { name: 'X-04 closed quoted field at EOF', input: { text: '"abc"', header: false } },
];

// Generator junk strings (csv-cases.mjs JUNK list), one case each: every junk value the
// scored data can produce after a closing quote.
const JUNK = ['kg', 'x', ' cm', '!', '?', ' (est.)', 'x"y'];
const CASES3 = JUNK.map((junk) => ({
  name: `G-01 generator junk ${JSON.stringify(junk)} after closing quote`,
  input: { text: `"v"${junk},w\n`, header: false },
}));

const ALL_CASES = [...CASES, ...CASES2, ...CASES3];

async function main() {
  let oracleMod;
  let candidateMod;
  try {
    oracleMod = await import(pathToFileURL(ORACLE_PATH).href);
  } catch (e) {
    console.error(`ERROR: cannot import oracle at ${ORACLE_PATH}: ${e.message}`);
    process.exit(2);
  }
  try {
    candidateMod = await import(pathToFileURL(CANDIDATE_PATH).href);
  } catch (e) {
    console.error(`ERROR: cannot import candidate at ${CANDIDATE_PATH}: ${e.message}`);
    process.exit(2);
  }
  const oracleRun = oracleMod.readCsv;
  const candidateRun = candidateMod.run;
  if (typeof oracleRun !== 'function') {
    console.error('ERROR: oracle exports no readCsv function');
    process.exit(2);
  }
  if (typeof candidateRun !== 'function') {
    console.error(`ERROR: candidate at ${CANDIDATE_PATH} exports no run function`);
    process.exit(2);
  }

  console.log(`Oracle:    ${ORACLE_PATH}`);
  console.log(`Candidate: ${CANDIDATE_PATH}`);
  console.log(`Cases:     ${ALL_CASES.length}`);
  console.log('---');

  let passed = 0;
  const failed = [];
  for (const c of ALL_CASES) {
    let expected;
    let actual;
    let threw = null;
    try {
      expected = oracleRun({ text: c.input.text, header: c.input.header });
    } catch (e) {
      console.log(`[FAIL] ${c.name}`);
      console.log(`  oracle itself threw (harness bug): ${e.message}`);
      failed.push(c.name);
      continue;
    }
    try {
      actual = candidateRun({ text: c.input.text, header: c.input.header });
    } catch (e) {
      threw = e;
    }
    if (threw) {
      console.log(`[FAIL] ${c.name}`);
      console.log(`  candidate threw: ${threw.message}`);
      console.log(`  input:    ${JSON.stringify(c.input)}`);
      console.log(`  expected: ${JSON.stringify(expected)}`);
      failed.push(c.name);
      continue;
    }
    if (deepEqual(actual, expected)) {
      console.log(`[PASS] ${c.name}`);
      passed += 1;
    } else {
      console.log(`[FAIL] ${c.name}`);
      console.log(`  diff:     ${findDiff(expected, actual, 'result')}`);
      console.log(`  input:    ${JSON.stringify(c.input)}`);
      console.log(`  expected: ${JSON.stringify(expected)}`);
      console.log(`  actual:   ${JSON.stringify(actual)}`);
      failed.push(c.name);
    }
  }

  console.log('---');
  console.log(`Passed ${passed}/${ALL_CASES.length}`);
  if (failed.length > 0) {
    console.log(`Failed (${failed.length}):`);
    for (const name of failed) console.log(`  - ${name}`);
    process.exit(1);
  }
  console.log('All edge cases pass.');
}

main();
