/**
 * Minimal RFC4180-ish CSV parser tailored to this codebase's only CSV use: the fixed
 * client/pet import format (see docs/superpowers/specs/2026-07-10-csv-client-import-design.md),
 * whose free-text `Notes` column may contain newlines pasted from Excel/Google Sheets.
 *
 * It runs a single-pass state machine over the whole input string (not line-by-line), so a
 * quoted field spanning multiple physical lines stays in one cell / one row:
 *  - `"` outside a quoted field opens one; inside a quoted field `""` is a literal `"` and a
 *    lone `"` closes the field.
 *  - `,` outside quotes ends a cell.
 *  - `\r\n`, lone `\r`, and lone `\n` outside quotes each end a row (a CRLF is one row break).
 *  - Any newline inside a quoted field is kept as a literal character in the cell.
 *
 * A hand-rolled parser avoids a dependency for this narrow, well-defined need.
 */
export function parseCsvRows(text: string): string[][] {
  if (text === '') return [];
  const rows: string[][] = [];
  let cells: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else if (ch === '\r' || ch === '\n') {
      // Row terminator: \r\n counts as a single break.
      if (ch === '\r' && text[i + 1] === '\n') i++;
      cells.push(cell);
      cell = '';
      rows.push(cells);
      cells = [];
    } else {
      cell += ch;
    }
  }

  cells.push(cell);
  rows.push(cells);
  return rows;
}
