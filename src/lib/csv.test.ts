import { describe, it, expect } from 'vitest';
import { csvCell, untrustedCsvCell, toCsv } from './csv';

describe('csvCell', () => {
  it('passes plain values through unchanged', () => {
    expect(csvCell('OC-ABCD1234')).toBe('OC-ABCD1234');
    expect(csvCell('sent')).toBe('sent');
  });

  it('renders null/undefined as an empty cell', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes and escapes fields containing a comma, quote, or newline', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('does not neutralize a leading formula character (trusted/server-controlled value)', () => {
    expect(csvCell('-12.50')).toBe('-12.50');
  });
});

describe('untrustedCsvCell', () => {
  it('passes ordinary customer text through unchanged', () => {
    expect(untrustedCsvCell('Jane Coach')).toBe('Jane Coach');
  });

  it.each(['=cmd', '+1', '-1', '@SUM(A1)', '\tfoo'])(
    'neutralizes a leading formula character: %s',
    (raw) => {
      expect(untrustedCsvCell(raw)).toBe(`'${raw}`);
    },
  );

  it('still quotes when the neutralized value also contains a comma', () => {
    expect(untrustedCsvCell('=A1,B1')).toBe('"\'=A1,B1"');
  });

  it('renders null as an empty cell', () => {
    expect(untrustedCsvCell(null)).toBe('');
  });
});

describe('toCsv', () => {
  it('joins cells with commas and rows with CRLF', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\r\nc,d');
  });
});
