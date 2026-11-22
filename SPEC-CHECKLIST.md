# SPEC CHECKLIST — csv-reader-speed-01-run-20261121

**Role:** correctness spec for the fast `solve.js` (ES module, `run(input)`).
**Oracle:** `baselines/csv-reader/vendor/csv-reader/index.js` (csv-reader 1.0.0, 193 lines),
`readCsv(input)`. The candidate MUST return a value deep-equal to the oracle's for every
input. The scorer compares JSON values (strings code unit for code unit, arrays in order,
objects with the same keys in any order). No other behaviour is scored.
**Sources read in full:** `RULES.txt` (279 lines), `competition.yaml`, the oracle `index.js`,
`program/generator/subject/csv-cases.mjs` (164 lines), baseline `solve.js` / `main.ts`.
**Scope of this file:** semantics only. It does NOT prescribe an implementation strategy.
All examples below were verified against the oracle on 2026-11-21.

---

## 1. Output contract

`run(input)` takes `{ text, header }` and returns `{ columns, rows, errors }`.

- `text` is coerced with `String(input.text)` (the oracle does `String(input.text)` first;
  e.g. numeric `123` reads as the text `"123"`). `header` is true only when
  `input.header === true` (strict); anything else, including a missing key, means no header.
- The function is pure: no state is kept from one call to the next. Each case is answered alone.
- `columns`:
  - `header === true`: the first non-skipped record, as an array of strings, exactly as read
    (never padded or cut, never checked for short/long). If there is no record at all
    (empty input, only blank lines, only stray-CR lines, BOM only), `columns` is `[]` — NOT null.
  - `header === false`: always `null`, even when there are no records.
- `rows`: an array with one array of strings per record after the first (every record when
  `header === false`). Every row has exactly `width` elements (see §5).
- `errors`: an array of error objects, in the order specified in §3.3. No other keys appear
  anywhere in the output.
- Field values are always strings. They are never trimmed, never converted to numbers,
  dates or booleans, never case-folded. `"007"`, `"1.0"`, `"TRUE"`, `"  a  "` stay exactly so.

### Empty-input edge (complete table)

| `text` | `header` | result |
|---|---|---|
| `""` | true | `{columns: [], rows: [], errors: []}` |
| `""` | false | `{columns: null, rows: [], errors: []}` |
| `"\uFEFF"` (BOM only) | true | `{columns: [], rows: [], errors: []}` |
| `"\uFEFF"` | false | `{columns: null, rows: [], errors: []}` |
| `"\n\n\n"` (blank lines only) | true | `{columns: [], rows: [], errors: []}` |
| `"\r\n\r\n"` | true | `{columns: [], rows: [], errors: []}` |
| `"\r"` (one lone CR) | false | `{columns: null, rows: [], errors: [{code: 'stray_cr', line: 1, row: 0}]}` |
| `"a,b,c"` (header only, no trailing break) | true | `{columns: ['a','b','c'], rows: [], errors: []}` |
| `"a,b,c\n"` | true | `{columns: ['a','b','c'], rows: [], errors: []}` |
| `"a,b,c"` | false | `{columns: null, rows: [['a','b','c']], errors: []}` |

---

## 2. Line counting (the `line` in every error)

- Lines are 1-based. `line` starts at 1. It is the line the CURRENT CHARACTER is on.
- Every `\n` increments `line` by exactly 1, whether it stands alone (LF) or follows a `\r`
  (CRLF counts as ONE line break, ONE increment). This holds inside and outside quoted fields,
  and in the blank-line skip at the start of a record.
- A lone `\r` OUTSIDE quotes does NOT increment `line` (it is dropped; see `stray_cr`).
- A lone `\r` INSIDE quotes DOES increment `line` by 1 (it is read as one `\n` in the value).
- A CRLF INSIDE quotes increments `line` by 1 (read as one `\n` in the value).
- `recordLine` = the value of `line` when the record STARTS, i.e. after blank lines preceding
  it have been skipped (those blank lines still incremented `line`). Every error for that
  record carries `line: recordLine`, NOT the line where the offending character sits.
- `row` = the record's index in `rows` (0-based). For the header record it is `null`.
  For a record that is later skipped (stray-CR-only line, §5.3), `row` is the value it WOULD
  have had (`rows.length` at that moment, or `null` if the header has not been consumed yet) —
  the errors from that line keep that `row` even though no row is produced.
- After an unterminated quote (§4.4), `line` is RESET to the line the opening quote was on
  (`openLine`); the increments counted while scanning the never-closed quoted span are
  discarded, and only the breaks met during the re-read are counted from there on.

---

## 3. Error codes — complete table

There are exactly five error codes. No `blank_line` code exists: a blank line is not an error
at all (it produces no record and no error). `stray_cr`, `quote_junk` and `unterminated_quote`
error objects have exactly the keys `{code, line, row}`. `short_row` adds `fields`;
`long_row` adds `extra`.

| Code | Trigger (exact) | Object shape | When emitted |
|---|---|---|---|
| `stray_cr` | A `\r` OUTSIDE a quoted field that is NOT followed by `\n`. The `\r` is dropped. One error per such `\r`. | `{code: 'stray_cr', line, row}` | Immediately, as the `\r` is met while reading an unquoted field (including inside quote-junk, §4.3, and inside the re-read tail of an unterminated quote, §4.4). |
| `quote_junk` | A quoted field closes, and at least one character is kept from what follows the closing quote up to the next comma, line break or end of text. (Kept = appended to the value; dropped lone CRs do not count.) | `{code: 'quote_junk', line, row}` | When that field ENDS (after the junk has been read). AFTER any `stray_cr` errors met inside the junk. |
| `unterminated_quote` | A field opens with `"` and no non-doubled `"` closes it before end of text. | `{code: 'unterminated_quote', line, row}` | When the scan reaches end of text without closing. BEFORE any `stray_cr` errors met in the re-read tail. Exactly one per unterminated field. |
| `short_row` | A non-header record has fewer fields than `width`. | `{code: 'short_row', line, row, fields: <original field count>}` | When the record ENDS, after all field-level errors of that record. The row is then padded with `""` to `width`. |
| `long_row` | A non-header record has more fields than `width`. | `{code: 'long_row', line, row, extra: [<the cut fields, in order>]}` | When the record ENDS, after all field-level errors of that record. The row is cut to `width` (the cut fields are the `extra` array itself). |

### 3.1 What is NOT an error

- A blank line (`\n` or `\r\n` with nothing on it): no record, no error. (A line holding
  only lone CRs is different — see §5.3: no record, but its `stray_cr` errors are kept.)
- A CRLF line break, inside or outside quotes: no error.
- A `"` inside an unquoted field: a literal character, no error.
- A doubled `""` inside a quoted field: one literal `"`, no error.
- A quoted field that closes and is immediately followed by `,`, a line break, or end of text:
  no error (no junk).
- A header record, whatever its length: never `short_row` / `long_row` (it DEFINES `width`).
- A record with exactly `width` fields: no `short_row` / `long_row`.

### 3.2 Error attribution — `line` and `row`

- `line` is ALWAYS `recordLine` (the line the record starts on), for every code, including
  `stray_cr` met on a later physical line of a multi-line record and `short_row` / `long_row`.
- `row` is ALWAYS `recordRow` (the record's index in `rows`, `null` for the header), for every
  code, including errors from a skipped stray-CR-only line (its would-be index).
- The header's field-level errors (`stray_cr`, `quote_junk`, `unterminated_quote`) carry
  `row: null`. The header never produces `short_row` / `long_row`.

### 3.3 Error order (the order `errors` is emitted)

Errors appear in scan order, with exactly two order rules:

1. Within one field: `unterminated_quote` is emitted BEFORE any `stray_cr` from its re-read
   tail; `stray_cr` errors inside quote-junk are emitted BEFORE the `quote_junk` for that field.
2. Within one record: all field-level errors (in field order, left to right) come BEFORE the
   record's `short_row` / `long_row`, which is emitted when the record ends.

There is no other reordering. In particular, a `short_row` / `long_row` is never emitted
before a field-level error of the same record, and errors of an earlier record never appear
after errors of a later record.

---

## 4. How fields are read (single left-to-right pass)

The text is read once, left to right. A field is read in exactly one of two ways, decided
by its FIRST character only: if the character at the field start is `"`, the field is
quoted (§4.2); otherwise it is unquoted (§4.1). A field starts at the beginning of a record
or immediately after a `,`.

### 4.1 Unquoted field

Read characters until a `,`, a line break, or end of text:

- `,` — the field ends, the record continues with the next field. The `,` is consumed.
- `\n` — the field and the record end. `line` += 1.
- `\r\n` — the field and the record end. `line` += 1 (one increment for the pair).
- `\r` NOT followed by `\n` — emit `stray_cr`, drop the `\r`, keep reading the SAME field.
  `line` does NOT change.
- Any other character, INCLUDING `"` — appended to the value literally. A quote inside an
  unquoted field never opens a quoted field, never closes anything, never errors.
- End of text — the field and the record end.

The value is the kept characters joined in order. An unquoted field can be empty
(`""` at a `,` / line break / end of text gives `""`).

### 4.2 Quoted field

The opening `"` is at the field start; it is consumed and is NOT part of the value.
Then read until the closing quote:

- `""` (two quotes in a row) — one literal `"` in the value; keep reading the quoted field.
- A single `"` NOT followed by `"` — the field closes. What happens next is §4.3.
- `\r\n` inside quotes — one `\n` in the value, `line` += 1.
- A lone `\r` inside quotes — one `\n` in the value, `line` += 1. (NOT a `stray_cr`.)
- `\n` inside quotes — one `\n` in the value, `line` += 1.
- Any other character — appended literally (including `,` — a comma inside quotes never
  ends the field).
- End of text without a closing quote — the unterminated-quote fallback, §4.4.

A quoted field may be empty: `""` reads as `""`. A quoted field may span many lines;
every line break inside it counts for `line` (§2) and is stored as `\n` in the value.

### 4.3 After the closing quote (quote-junk)

When a quoted field closes, look at the next character:

- End of text — the field ends. No error.
- `,` — the field ends, the record continues. No error.
- `\n` — the field and the record end, `line` += 1. No error.
- `\r\n` — the field and the record end, `line` += 1. No error.
- ANYTHING ELSE — the rest of the field is read by the UNQUOTED reader (§4.1), starting
  from the value already built, up to the next `,`, line break or end of text:
  - Everything the unquoted reader keeps is APPENDED to the value as-is (this is the "junk").
  - A `"` in the junk is a literal character (the unquoted reader treats it so).
  - A lone `\r` in the junk is dropped WITH a `stray_cr` error (emitted before `quote_junk`).
  - If the unquoted reader kept AT LEAST ONE character (`added > 0`), emit `quote_junk`
    when the field ends. If it kept ZERO characters — i.e. the junk consisted only of
    dropped lone CRs — emit NO `quote_junk` (the `stray_cr` errors still stand).
  - The field then ends exactly as the unquoted reader ended it (comma / line break / end).

Examples (verified against the oracle):

| Input (header false) | Field value | Errors |
|---|---|---|
| `"a"x,b` | `ax` | `quote_junk` |
| `"a"x"y,b` | `ax"y` | `quote_junk` (the `"` in the junk is literal) |
| `"a""b"z` | `a"bz` | `quote_junk` |
| `"a"\r,b` | `a` | `stray_cr` only — NO `quote_junk` (0 chars kept) |
| `"a"\rx,b` | `ax` | `stray_cr` THEN `quote_junk` (in that order) |
| `"a"junk\r\nb,c` | `ajunk` | `quote_junk` |
| `"a"zz` (EOF) | `azz` | `quote_junk` |
| `"a",b` / `"a"\nb` / `"a"` (EOF) | `a` | none |

### 4.4 Unterminated quote — the fallback, in full

If a quoted field never closes (end of text is reached while still inside it):

1. Emit ONE `unterminated_quote` error (`line: recordLine`, `row: recordRow`).
2. The opening quote becomes a LITERAL character: it is the first character of the
   re-read field's value.
3. The read position is RESET to `open + 1` (the character just after the opening quote).
4. `line` is RESET to `openLine` (the line the opening quote was on). All line increments
   counted while scanning the never-closed span are discarded.
5. The text from `open + 1` onward is RE-READ as an UNQUOTED field (§4.1), starting with
   the value `"` (the literal opening quote). This re-read:
   - ends at the first `,`, line break or end of text, exactly like any unquoted field;
   - treats every `"` in the tail as a literal character (including `""` pairs — the
     doubling rule does NOT apply in the re-read);
   - drops every lone `\r` in the tail WITH a `stray_cr` error each (emitted AFTER the
     `unterminated_quote` error);
   - counts `\n` / `\r\n` in the tail as line breaks (`line` += 1 each) from the reset value.
6. The field then ends exactly as the re-read ended it (comma / line break / end), and the
   record continues normally from there: the characters after the re-read field's end are
   read as further fields / records as usual. The re-read NEVER consumes the whole rest of
   the text as one field.
7. NO `quote_junk` is ever emitted for an unterminated field, whatever follows.
8. There is exactly one `unterminated_quote` error per unterminated field. (A file can
   contain at most one in practice — after the fallback the rest of the text is read as
   unquoted, so no second quoted field can open — unless a later field starts with `"`
   after a comma / line break in the re-read tail, which CAN open a new quoted field and
   CAN itself be unterminated. Do not assume "at most one per file".)

Examples (verified against the oracle):

| Input | Result (essence) |
|---|---|
| `"abc` (header false) | rows `[['"abc']]`, errors `[unterminated_quote line 1 row 0]` |
| `a,b\n"x,y\n3,4\n` (header true) | rows `[['"x','y'],['3','4']]`, errors `[unterminated_quote line 2 row 0]` — the `,` and `\n` inside the "quoted" span became a separator and a break after the fallback |
| `a,b\n"x\ry,z\n` (header true) | rows `[['"xy','z']]`, errors `[unterminated_quote line 2 row 0, stray_cr line 2 row 0]` — the `\r` in the tail IS a stray CR |
| `h1,h2\n"a\r\nb\nc,d\n` (header true) | rows `[['"a',''],['b',''],['c','d']]`, errors `[unterminated_quote line 2 row 0, short_row line 2 row 0 fields 1, short_row line 3 row 1 fields 1]` — the CRLF+LF counted during the failed scan are discarded by the line reset; the re-read field ends at the CRLF, the next record starts on line 3 |
| `"a""b,c\n1,2\n` (header false) | rows `[['"a""b','c'],['1','2']]`, errors `[unterminated_quote line 1 row 0]` — the `""` pair is literal in the re-read |
| `"a,b\n1,2\n` (header true) | columns `['"a','b']`, errors `[unterminated_quote line 1 row null]` — the header can be the unterminated record |

---

## 5. Record assembly

### 5.1 Blank lines (before a record)

At the start of each record, skip blank lines: while the next characters are `\n`, or
`\r\n`, consume them (`line` += 1 each) and keep skipping. A lone `\r` is NOT skipped here
(it is not a blank line — see §5.3). After skipping, if end of text is reached, stop:
no further record. `recordLine` / `recordRow` are captured AFTER this skipping.

- A blank line produces NO record and NO error, wherever it appears (start of file,
  between records, after the header, at end of file).
- Blank lines still advance `line`, so the next record's `recordLine` counts them.
- A trailing line break after the last record does NOT create an extra empty record:
  `"a,b\n"` is one record, not two. `"a,b"` (no trailing break) is the same one record.

### 5.2 Width, padding and cutting

- `width` is set by the FIRST non-skipped record, INCLUDING the header when `header` is
  true. It is never changed afterwards. A skipped stray-CR-only line (§5.3) does NOT set it.
- The header record is stored in `columns` exactly as read (its length IS `width`).
- Every later record is forced to `width` fields:
  - Fewer fields: emit `short_row` with `fields` = the ORIGINAL field count, then pad the
    row with `""` (empty strings) until it has `width` fields.
  - More fields: emit `long_row` with `extra` = the cut fields (all fields past `width`, in
    order, as a new array), then cut the row to `width` fields.
  - Exactly `width`: no error, no change.
- `recordRow` for a record is `rows.length` at the moment the record starts (`null` while
  the header is still unconsumed and `header` is true). It is captured BEFORE the record is
  read, so field-level errors of that record already carry the right `row`.

### 5.3 Stray-CR-only lines (no record, errors kept)

After a record's fields have been read, if it has exactly ONE field, that field is `""`,
and that field was NOT quoted (`fields.length === 1 && fields[0] === '' && !quoted`),
the record is DISCARDED: no row is pushed, `width` is not set by it, the header is not
consumed by it, and no `short_row` / `long_row` is emitted for it. Its `stray_cr` errors
(with the `line` / `row` captured at its start) REMAIN in `errors`.

When this happens: a line holding only lone CRs, e.g. `\r\r\n` (the first `\r` is a stray
CR, the second `\r\n` ends the line) or `\r` at end of text. Note the contrast:

- `\r\n` alone is a BLANK line (§5.1): skipped before any record starts, NO error at all.
- `\r\r\n` is a stray-CR-only line: ONE `stray_cr`, no record.
- `\r` at end of text: ONE `stray_cr`, no record.
- `""` (a quoted empty field) is a REAL record of one empty field — `quoted` is true, so
  it is NOT discarded.
- A line `\rX\n` is a real record `['X']` with a `stray_cr` (the field is not empty).

Verified examples:

| Input (header true) | Errors | Rows |
|---|---|---|
| `a,b\n\r\r\n1,2\n` | `[stray_cr line 2 row 0]` | `[['1','2']]` |
| `a,b\n\r` (EOF) | `[stray_cr line 2 row 0]` | `[]` |
| `\r\r\na,b\n1,2\n` | `[stray_cr line 1 row null]` | `[['1','2']]` (header still `['a','b']`) |
| `\r` alone, header false | `[stray_cr line 1 row 0]` | `[]`, columns `null` |

### 5.4 How a record ends

A record ends when a field ends with a line break (`\n` or `\r\n`) or with end of text.
A trailing `,` still starts one more (empty) field: `"a,b,"` reads as `['a','b','']`, and
`","` reads as `['','']`. A leading `,` gives a leading empty field. `",,"` is three
empty fields. A record with no trailing break at end of text is still a complete record.

---

## 6. BOM, characters, and other exact rules

- **BOM:** a U+FEFF at the VERY START of the text (position 0) is dropped — it is not a
  field character, does not start a record, does not affect `line`. A U+FEFF anywhere else
  is an ordinary character kept in the field value (e.g. `"\uFEFFx"` as a field is
  `"\uFEFFx"`). Only ONE BOM is dropped (a second U+FEFF at position 1 is kept).
  BOM + quoted first field works: `"\uFEFF\"a\",b"` reads as `[['a','b']]`.
- **Quoted-field detection is positional:** only a `"` that is the FIRST character of a
  field opens a quoted field. `" "a""` (space before the quote) is an unquoted field whose
  value keeps the quotes literally. A `"` after a comma opens a quoted field; a `"` after
  any other character does not.
- **No trimming / no conversion:** see §1. Leading/trailing spaces inside or outside quotes
  are kept: `"  a  "` (unquoted) stays `"  a  "`; `"\"  x  \""` (quoted) stays `"  x  "`.
- **Unicode:** text is a UTF-16 JS string. All characters (including non-ASCII such as
  `Zürich`, `naïve`, `Δέλτα`) are kept code unit for code unit. There is no encoding step and
  no normalisation. A fast scanner must not split surrogate pairs or re-encode the text.
- **Doubled quotes:** inside a quoted field `""` is exactly one `"`. `"""""` (4 quotes)
  is one field whose value is `"`. `"""a"""` is not valid input to reason about by eye —
  trace it through §4.2 mechanically instead of guessing.
- **Determinism:** the same input always gives the same output. Nothing depends on time,
  randomness, locale, or call order.

---

## 7. What the scored data looks like (generator distribution)

From `program/generator/subject/csv-cases.mjs`. The fast path must be fast on THIS
 distribution; the edge paths must be right on its broken records.

- One case: 1.4–2.0 M characters, 8–18 columns, ~6,250–14,171 rows per file.
- Column kinds per file: `int`, `decimal`, `date`, `code`, `word`, `phrase` (may hold commas
  and quotes), `note` (15% span 2–4 lines), `maybe` (40% empty). A plain field is needlessly
  quoted 1% of the time. Quotes are ~3% of all characters.
- Line break per file: LF or CRLF, 50/50. BOM on 1 file in 3. Header on 2 files in 3
  (`header` is true when the case index % 3 != 2, so every set of 3+ cases holds both).
- Broken records (per record after the header, one cumulative draw each): `short_row` 1%,
  `long_row` 1% (short: cut to width − 1..3; long: 1–3 extra fields), `stray_cr` 0.4%
  (a `word\rword` field), `quote_junk` 0.4% (junk drawn from `['kg','x',' cm','!','?',
  ' (est.)','x"y']`), `blank_line` 0.3% (an extra line break before the record).
  About 97% of records are clean.
- Unterminated quote on 50% of files: a `"` opens the first of the last 1–20 records and
  never closes; those tail records hold NO quote at all and are otherwise bare (no commas,
  quotes or line breaks inside a field value — the field separators are still commas).
- The last line break is omitted on 30% of files.
- Practice-set profile (measured): 6 cases, 10.19 MB text, 63,692 rows, 1,770 errors
  (2.8% of rows) — `long_row` 603, `short_row` 621, `quote_junk` 284, `stray_cr` 260,
  `unterminated_quote` 2.
- The scored set is drawn from a different drand round and is unknowable in advance;
  do not tune to the practice set's exact contents — tune to this distribution.

---

## 8. The 6 ranked correctness traps (memo §4.6) — each with a concrete example

### Trap 1 — Unterminated-quote fallback (the killer; present in ~50% of files)

A quote that never closes is a LITERAL character, the position resets to `open + 1`, the
line resets to `openLine`, the error is recorded, and the tail is RE-READ as unquoted —
including any `stray_cr` inside the re-read tail. A scanner that "handles" unterminated
quotes by slurping to end of text WILL FAIL these cases.

- Input: `a,b\n"x,y\n3,4\n`, header true.
- Oracle: `columns ['a','b']`, rows `[['"x','y'],['3','4']]`,
  errors `[{code:'unterminated_quote', line:2, row:0}]`.
- Wrong answer to avoid: one row `['"x,y\n3,4\n']` (slurped to EOF), or the record
  ending at EOF with no `['3','4']` row.
- Also see §4.4: the `\r` in `"x\ry,z` after the fallback IS a `stray_cr`, and the
  CRLF/LF counted during the failed scan are discarded by the line reset.

### Trap 2 — Quote-junk with quotes inside it

Junk after a closing quote is appended as-is and read by the UNQUOTED reader, where a `"`
is literal. A scanner that treats any `"` after a closing quote as a new quoted field
WILL FAIL.

- Input: `"a"x"y,b\n`, header false.
- Oracle: rows `[['ax"y','b']]`, errors `[{code:'quote_junk', line:1, row:0}]`.
- Wrong answer to avoid: `[['ax','y,b']]` (re-opening a quoted field at the junk quote),
  or `[['a','x"y','b']]` (splitting the junk off as its own field).
- The generator's junk list includes `'x"y'` — this exact shape occurs in scored data.

### Trap 3 — Line attribution for errors

`line` is the 1-based line the RECORD STARTS on, counting every LF, CRLF and lone CR
INSIDE quoted fields; `row` is the record's index in `rows` (`null` for the header).
`short_row` / `long_row` are pushed when the record ends, with the record's start line.
Getting this wrong on multi-line notes (15% of note columns) breaks cases silently.

- Input: `a,b\n"x\ny",2\n3\n`, header true.
- Oracle: rows `[['x\ny','2'],['3','']]`,
  errors `[{code:'short_row', line:4, row:1, fields:1}]` — the second record starts on
  line 4 (the note occupied lines 2–3), NOT line 3.
- Wrong answer to avoid: `short_row` with `line: 3` (counting only the record's own line),
  or `line: 2` (the line the multi-line field opened on), or `row: 0`.
- Same rule for `stray_cr` met in a later field of a multi-line record: in
  `a,b\n"x\ny",2\r3\n` the `stray_cr` carries `line: 2, row: 0` (verified).

### Trap 4 — "Only stray CRs" lines

A line holding only stray CRs produces NO record but KEEPS its `stray_cr` errors
(`fields.length === 1 && fields[0] === '' && !quoted` → skip).

- Input: `a,b\n\r\r\n1,2\n`, header true.
- Oracle: rows `[['1','2']]`, errors `[{code:'stray_cr', line:2, row:0}]`.
- Wrong answers to avoid: a row `['']` (or `['','']`) for the CR line; dropping the
  `stray_cr`; treating `\r\n` the same way (a bare `\r\n` line is a blank line — NO
  error at all); discarding a quoted `""` line (that IS a record).
- If the stray-CR-only line comes before the header, its error carries `row: null` and
  the header is still the next record (verified: `\r\r\na,b\n1,2\n`).

### Trap 5 — Empty input / header edge

`columns` is `[]` (not null) when `header` is true and there are no records; `null` when
`header` is false. Width is set by the first record INCLUDING the header.

- Input: `""`, header true → `{columns: [], rows: [], errors: []}`.
  Input: `""`, header false → `{columns: null, rows: [], errors: []}`.
- Input: `a,b\n1,2,3\n4\n`, header true → rows `[['1','2'],['4','']]` with
  `long_row {line:2, row:0, extra:['3']}` and `short_row {line:3, row:1, fields:1}` —
  the header's width (2) governs both, even though the header itself is never
  short/long-checked.
- Wrong answers to avoid: `columns: null` for header-true empty input; width taken from
  the first DATA row instead of the header; a `short_row` for the header.

### Trap 6 — CRLF inside quotes becomes LF; lone CR outside is dropped WITH an error

CRLF inside quotes → LF in the value; lone CR inside quotes → LF; lone CR outside
quotes → dropped WITH a `stray_cr` error; CRLF outside quotes = one line break.
A bulk scanner must not conflate the two contexts.

- Input: `"a\r\nb",c\n` (header false) → rows `[['a\nb','c']]`, no errors.
- Input: `"a\rb",c\n` → rows `[['a\nb','c']]`, no errors (the lone CR became LF).
- Input: `a\rb,c\n` → rows `[['ab','c']]`, errors `[{code:'stray_cr', line:1, row:0}]`.
- Input: `a,b\r\nc,d\r\n` → two rows, no errors (CRLF outside is one break, not two).
- Wrong answers to avoid: keeping `\r\n` / `\r` literally in a quoted value; counting a
  CRLF as two lines; silently dropping a lone CR outside quotes without the error;
  treating a lone CR inside quotes as a `stray_cr`.

---

## 9. Notes for the performance engineer (what the fast path must NOT break)

These are consequences of the spec above, listed because a bulk scanner is tempted to
violate each of them. They are requirements, not suggestions.

1. A line-based fast path ("split the text into lines, then split each line on commas")
   is WRONG unless it first proves the line holds no `"`: quoted fields span lines, and
   a `,` / line break inside quotes is not a separator. The clean-line fast path must be
   gated on "no quote character in this record's span".
2. An `indexOf`-based scanner must still find `\r` (for `stray_cr` and for the CRLF-vs-
   lone-CR distinction) and must not treat `\r\n` as two breaks. Scanning for `\n` alone
   and assuming the previous character decides CRLF is not enough inside quotes, where a
   lone `\r` is a line break AND a value character (`\n`).
3. Line numbers cannot be derived from "record index" or from counting `\n` in the whole
   text up to a point: lone CRs inside quotes increment `line` without appearing as `\n`,
   and the unterminated-quote reset discards increments. Keep an exact `line` counter
   through every path, including the fallback.
4. Do not defer `stray_cr` / `quote_junk` / `unterminated_quote` bookkeeping in a way that
   changes their ORDER (§3.3) or their `line` / `row`. `short_row` / `long_row` must be
   emitted after the record's field errors, never before.
5. Do not cache anything from one `run()` call to the next, and do not assume the input
   text is the practice set. Each case is answered alone; the scored set is drawn fresh.
6. Do not trim, split on a regex, or convert field values. Do not use a public CSV library
   (d3-dsv, papaparse, csv-parser) as the reader: each reads broken rows its own way and
   fails the gate. Their SPEED is the target; their SEMANTICS are not.
7. The `extra` array of a `long_row` error and the padded `""` strings of a `short_row`
   are part of the compared output — they must be exactly the oracle's (order, values).
8. Watch the `added > 0` rule for `quote_junk` (§4.3): junk of only dropped CRs is NOT
   `quote_junk`. A scanner that flags "anything after the closing quote" will over-report.
9. Watch the `!quoted` condition of the stray-CR-only skip (§5.3): a one-field record
   `""` (quoted empty) is a real row; a one-field record `""` (unquoted empty, from lone
   CRs) is not.
10. The header's `row` is `null` in its field-level errors. A scanner that stamps errors
    with `rows.length` unconditionally will stamp the header's errors with `row: 0`.

---

## 10. Verification checklist (for the verification engineer)

- [ ] `test-edge-cases.mjs` passes 100% against the candidate (and, as a harness check,
      against the oracle itself used as the candidate).
- [ ] Practice set via `grade-local`: 6/6 cases identical to the reference.
- [ ] At least 20 generated sets from the kit generator with fresh seeds, diffed against
      the oracle: 20/20 identical.
- [ ] Practice-set benchmark: median of 5+ rounds vs the reference; kill-switch is
      < 1.5x speedup (see greenlight memo §7) — do not submit below it.
- [ ] Every change re-runs the full verification (no change without re-running the suite).

*End of checklist.*
