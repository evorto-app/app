import { describe, expect, it } from '@effect/vitest';

import { encodeCsv, guardCsvCell } from './csv';

const BOM = '﻿';

describe('encodeCsv', () => {
  it('prefixes a BOM and ends every row with CRLF', () => {
    expect(
      encodeCsv([
        ['a', 'b'],
        ['c', 'd'],
      ]),
    ).toBe(`${BOM}a,b\r\nc,d\r\n`);
  });

  it('leaves plain and empty cells untouched', () => {
    expect(encodeCsv([['plain', '', 'Müller Ärger']])).toBe(
      `${BOM}plain,,Müller Ärger\r\n`,
    );
  });

  it('produces only the BOM for no rows', () => {
    expect(encodeCsv([])).toBe(BOM);
  });

  it('quotes cells with commas, quotes and line breaks', () => {
    expect(encodeCsv([['a,b', 'say "hi"', 'line\nbreak', 'cr\rbreak']])).toBe(
      `${BOM}"a,b","say ""hi""","line\nbreak","cr\rbreak"\r\n`,
    );
  });

  it.each(['=', '+', '-', '@', '\t', '\r'])(
    'prefixes cells starting with %j',
    (trigger) => {
      expect(guardCsvCell(`${trigger}1+1`)).toBe(`'${trigger}1+1`);
    },
  );

  it('does not prefix trigger characters that are not leading', () => {
    expect(guardCsvCell('a=b')).toBe('a=b');
    expect(guardCsvCell('')).toBe('');
  });

  it('applies the guard before quoting', () => {
    expect(encodeCsv([['=SUM(A1,A2)', '@x', '-1', '+1']])).toBe(
      `${BOM}"'=SUM(A1,A2)",'@x,'-1,'+1\r\n`,
    );
    expect(encodeCsv([['\tTab'], ['\rCr']])).toBe(
      `${BOM}'\tTab\r\n"'\rCr"\r\n`,
    );
  });

  it('guards the header row like any other row', () => {
    expect(encodeCsv([['=Header'], ['value']])).toBe(
      `${BOM}'=Header\r\nvalue\r\n`,
    );
  });
});
