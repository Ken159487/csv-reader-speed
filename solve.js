// Fast drop-in replacement for csv-reader 1.0.0.
// Semantics are byte-identical to the oracle; speed comes from bulk native
// scanning (indexOf / slice / split) instead of per-character loops.
// A clean record (no quote and no stray CR in its span) is handled by one
// slice plus split(','). Every other field is read by indexOf-based readers
// that jump between commas, line breaks and quotes. The unquoted reader is
// inlined in the record loop and readers report through shared out-vars, so
// the hot path allocates no per-field result objects.
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const len = text.length;
  let pos = 0;
  let line = 1;
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  let recordLine = 1;
  let recordRow = null;

  const COMMA = 0;
  const BREAK = 1;
  const END = 2;

  // Shared field-result out-vars: fv is the field value, fe its terminator.
  // Readers set these instead of allocating a result object per field.
  let fv = '';
  let fe = END;

  // Read an unquoted field starting at pos, appending to value.
  // added counts the characters kept during this read (not the initial value).
  // Only used for the rare quote-junk path; the common unquoted path is
  // inlined in the record loop below.
  function readUnquoted(value) {
    let added = 0;
    for (;;) {
      const ci = text.indexOf(',', pos);
      const ni = text.indexOf('\n', pos);
      let limit;
      let isComma;
      if (ci === -1 && ni === -1) {
        limit = len;
        isComma = false;
      } else if (ci === -1) {
        limit = ni;
        isComma = false;
      } else if (ni === -1) {
        limit = ci;
        isComma = true;
      } else if (ci < ni) {
        limit = ci;
        isComma = true;
      } else {
        limit = ni;
        isComma = false;
      }
      if (limit > pos) {
        const seg = text.slice(pos, limit);
        const ri = seg.indexOf('\r');
        if (ri === -1) {
          if (seg !== '') value = value === '' ? seg : value + seg;
          added += seg.length;
          if (limit === len) {
            pos = len;
            return { value, ended: END, added };
          }
          if (isComma) {
            pos = limit + 1;
            return { value, ended: COMMA, added };
          }
          pos = limit + 1;
          line += 1;
          return { value, ended: BREAK, added };
        }
        // A CR inside the segment: CRLF at its end (followed by the LF at
        // limit) ends the field as a line break; any other CR is a stray CR.
        // limit < len here means limit is a real LF position; at end of text
        // a trailing CR is a stray CR, not half of a CRLF.
        if (!isComma && limit < len && ri === seg.length - 1) {
          const part = seg.slice(0, ri);
          if (part !== '') value += part;
          added += part.length;
          pos = limit + 1;
          line += 1;
          return { value, ended: BREAK, added };
        }
        const part = seg.slice(0, ri);
        if (part !== '') value += part;
        added += part.length;
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        pos = pos + ri + 1;
        continue;
      }
      // Empty segment: the field ends at the terminator (or at end of text).
      if (limit === len) {
        pos = len;
        return { value, ended: END, added };
      }
      if (isComma) {
        pos = limit + 1;
        return { value, ended: COMMA, added };
      }
      pos = limit + 1;
      line += 1;
      return { value, ended: BREAK, added };
    }
  }

  // Read a quoted field whose opening quote is at pos. Sets fv / fe.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let value = '';
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // Never closes: the quote is literal, re-read from open + 1 as
        // unquoted, with the line reset to the opening quote's line.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        const r = readUnquoted('"');
        fv = r.value;
        fe = r.ended;
        return;
      }
      if (q > pos) {
        const seg = text.slice(pos, q);
        if (seg.indexOf('\r') === -1 && seg.indexOf('\n') === -1) {
          value = value === '' ? seg : value + seg;
        } else {
          // Convert every CRLF / lone CR / LF inside quotes to one LF.
          let s = 0;
          while (s < seg.length) {
            const r2 = seg.indexOf('\r', s);
            const n2 = seg.indexOf('\n', s);
            let idx;
            let isCR;
            if (r2 === -1 && n2 === -1) {
              value += seg.slice(s);
              break;
            }
            if (r2 === -1) {
              idx = n2;
              isCR = false;
            } else if (n2 === -1) {
              idx = r2;
              isCR = true;
            } else if (r2 < n2) {
              idx = r2;
              isCR = true;
            } else {
              idx = n2;
              isCR = false;
            }
            if (idx > s) value += seg.slice(s, idx);
            value += '\n';
            line += 1;
            s = isCR && seg.charCodeAt(idx + 1) === 10 ? idx + 2 : idx + 1;
          }
        }
      }
      if (q + 1 < len && text.charCodeAt(q + 1) === 34) {
        // Doubled quote: one literal quote, keep reading the quoted field.
        value += '"';
        pos = q + 2;
        continue;
      }
      // Closing quote.
      pos = q + 1;
      if (pos >= len) {
        fv = value;
        fe = END;
        return;
      }
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        fv = value;
        fe = COMMA;
        return;
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        fv = value;
        fe = BREAK;
        return;
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        fv = value;
        fe = BREAK;
        return;
      }
      // Junk after the closing quote is read by the unquoted reader.
      const junk = readUnquoted(value);
      if (junk.added > 0) {
        errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      }
      fv = junk.value;
      fe = junk.ended;
      return;
    }
  }

  for (;;) {
    // Skip blank lines (LF or CRLF with nothing on them).
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    let fields;
    let quoted = false;

    // Fast path: the record's span up to the next LF holds no quote and no
    // stray CR, so the whole record is one slice split on commas. The quote
    // and CR checks run on the text itself (bounded by the line end, with
    // the trailing CRLF CR exempted), so slow-path records pay for no slice.
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? len : nl;
    const qi = text.indexOf('"', pos);
    const ri2 = text.indexOf('\r', pos);
    if (
      (qi === -1 || qi >= end) &&
      (ri2 === -1 || ri2 >= end || (nl !== -1 && ri2 === end - 1))
    ) {
      const seg =
        nl !== -1 && end > pos && text.charCodeAt(end - 1) === 13
          ? text.slice(pos, end - 1)
          : text.slice(pos, end);
      fields = seg.split(',');
      if (nl === -1) {
        pos = len;
      } else {
        pos = nl + 1;
        line += 1;
      }
    } else {
      fields = [];
      do {
        quoted = text.charCodeAt(pos) === 34;
        if (quoted) {
          readQuoted();
        } else {
          // Inlined unquoted field read (same semantics as readUnquoted
          // with an empty initial value); sets fv / fe, no call, no object.
          let val = '';
          for (;;) {
            const ci = text.indexOf(',', pos);
            const ni = text.indexOf('\n', pos);
            let limit;
            let isComma;
            if (ci === -1 && ni === -1) {
              limit = len;
              isComma = false;
            } else if (ci === -1) {
              limit = ni;
              isComma = false;
            } else if (ni === -1) {
              limit = ci;
              isComma = true;
            } else if (ci < ni) {
              limit = ci;
              isComma = true;
            } else {
              limit = ni;
              isComma = false;
            }
            if (limit > pos) {
              const seg = text.slice(pos, limit);
              const ri = seg.indexOf('\r');
              if (ri === -1) {
                if (seg !== '') val = val === '' ? seg : val + seg;
                if (limit === len) {
                  pos = len;
                  fe = END;
                } else if (isComma) {
                  pos = limit + 1;
                  fe = COMMA;
                } else {
                  pos = limit + 1;
                  line += 1;
                  fe = BREAK;
                }
                break;
              }
              if (!isComma && limit < len && ri === seg.length - 1) {
                const part = seg.slice(0, ri);
                if (part !== '') val += part;
                pos = limit + 1;
                line += 1;
                fe = BREAK;
                break;
              }
              const part = seg.slice(0, ri);
              if (part !== '') val += part;
              errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
              pos = pos + ri + 1;
              continue;
            }
            if (limit === len) {
              pos = len;
              fe = END;
            } else if (isComma) {
              pos = limit + 1;
              fe = COMMA;
            } else {
              pos = limit + 1;
              line += 1;
              fe = BREAK;
            }
            break;
          }
          fv = val;
        }
        fields.push(fv);
      } while (fe === COMMA);
    }

    // A line holding only stray CRs is no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
