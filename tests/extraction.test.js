import { describe, test, expect, beforeAll } from 'bun:test';
import { readdir }        from 'node:fs/promises';
import { readFileSync }   from 'node:fs';
import { join }           from 'node:path';
import { configurePDFWorker, extractTextFromPDF } from '../src/extract-pdf.js';
import { lookupIATA, isKnownIATA }  from '../src/airports.js';
import { parse }          from '../src/parsers/index.js';
import { generateICS }    from '../src/ics.js';

beforeAll(() => configurePDFWorker(''));

const FIXTURES = join(import.meta.dir, 'fixtures');

describe('airport lookup', () => {
  test('JFK resolves correctly', () => {
    const a = lookupIATA('JFK');
    expect(a).not.toBeNull();
    expect(a.tz).toBe('America/New_York');
    expect(typeof a.lat).toBe('number');
    expect(typeof a.lon).toBe('number');
  });

  test('SVO resolves correctly', () => {
    expect(lookupIATA('SVO')?.tz).toBe('Europe/Moscow');
  });

  test('unknown code returns null', () => {
    expect(lookupIATA('XXX')).toBeNull();
  });
});

describe('ICS generation', () => {
  test('generates valid ICS for flight leg', () => {
    const legs = [{
      flightNumber: 'SU 1234',
      airline: null,
      departure: { iata: 'SVO', datetime: '2025-06-01T10:00', terminal: null },
      arrival: { iata: 'JFK', datetime: '2025-06-01T14:00', terminal: null },
      passenger: null,
      bookingRef: null,
      seat: null,
      class: null,
    }];

    const ics = generateICS(legs, lookupIATA);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).toContain('DTSTART;TZID=Europe/Moscow:20250601T100000');
    expect(ics).toContain('DTEND;TZID=America/New_York:20250601T140000');
    expect(ics).toContain('SU 1234');
  });
});

describe('PDF fixtures', async () => {
  let files = [];
  try {
    files = (await readdir(FIXTURES)).filter(f => f.endsWith('.pdf'));
  } catch { }

  for (const file of files) {
    test(`parses ${file}`, async () => {
      const buf  = readFileSync(join(FIXTURES, file));
      const text = await extractTextFromPDF(buf.buffer);

      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);

      const { parser, legs } = parse(text, lookupIATA);
      console.log(`  [${file}] parser=${parser}, legs=${legs.length}`);

      for (const leg of legs) {
        expect(leg.departure?.iata).toMatch(/^[A-Z]{3}$/);
        expect(leg.arrival?.iata).toMatch(/^[A-Z]{3}$/);
        expect(leg.departure?.datetime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
        expect(leg.arrival?.datetime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
        expect(isKnownIATA(leg.departure.iata)).toBe(true);
        expect(isKnownIATA(leg.arrival.iata)).toBe(true);
      }

      const ics = generateICS(legs, lookupIATA);
      expect(ics).toContain('BEGIN:VCALENDAR');
      expect(ics).toContain('END:VCALENDAR');
      if (legs.length > 0) {
        expect(ics).toContain('DTSTART;TZID=');
        expect(ics).toContain('DTEND;TZID=');
      }
    });
  }
});
