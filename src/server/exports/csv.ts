const UTF8_BOM = '﻿';
const LINE_BREAK = '\r\n';
const FORMULA_TRIGGER_CHARACTERS = new Set(['\t', '\r', '+', '-', '=', '@']);

/**
 * Neutralises spreadsheet formula injection: a cell that starts with a formula
 * trigger character gets a leading apostrophe so Excel and friends show it as
 * text instead of evaluating it.
 */
export const guardCsvCell = (cell: string): string =>
  cell.length > 0 && FORMULA_TRIGGER_CHARACTERS.has(cell.charAt(0))
    ? `'${cell}`
    : cell;

const quoteCsvCell = (cell: string): string =>
  /["\n\r,]/u.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;

/**
 * RFC 4180 CSV document: CRLF rows with a trailing CRLF, a UTF-8 BOM so Excel
 * detects the encoding, and the formula-injection guard on every cell.
 */
export const encodeCsv = (rows: readonly (readonly string[])[]): string =>
  UTF8_BOM +
  rows
    .map(
      (row) =>
        row.map((cell) => quoteCsvCell(guardCsvCell(cell))).join(',') +
        LINE_BREAK,
    )
    .join('');
