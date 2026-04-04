import { describe, test, expect, beforeAll } from 'bun:test';
import { readdir }        from 'node:fs/promises';
import { readFileSync }   from 'node:fs';
import { join }           from 'node:path';
import { configurePDFWorker, buildPDFTree } from '../src/extract-pdf-tree.js';
import { lookupIATA, isKnownIATA }  from '../src/airports.js';
import { parse }          from '../src/parsers/index.js';
import { generateICS }    from '../src/ics.js';

const workerPath = join(import.meta.dir, '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
beforeAll(() => configurePDFWorker(workerPath));

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

  test('BEG resolves correctly', () => {
    expect(lookupIATA('BEG')?.tz).toBe('Europe/Belgrade');
  });

  test('LJU resolves correctly', () => {
    expect(lookupIATA('LJU')?.tz).toBe('Europe/Ljubljana');
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

describe('PDF parsing specific cases', () => {
  test('parses Russian itinerary with multiple legs correctly', async () => {
    const buf = readFileSync(join(FIXTURES, 'attachment_1325726d78c16f0faf484dcfae3fc1c9.pdf'));
    const tree = await buildPDFTree(buf.buffer);
    
    expect(tree).toBeDefined();
    expect(tree.type).toBe('document');
    expect(tree.pages.length).toBeGreaterThan(0);
    
    const { parser, legs } = parse(tree, lookupIATA);
    console.log(`  [attachment_1325726d78c16f0faf484dcfae3fc1c9.pdf] parser=${parser}, legs=${legs.length}`);
    
    // Should parse 4 flight legs
    expect(legs.length).toBe(4);
    
    // Check first leg: SVO to BEG
    const leg1 = legs[0];
    expect(leg1.flightNumber).toMatch(/^JU \d+$/);
    expect(leg1.departure.iata).toBe('SVO');
    expect(leg1.arrival.iata).toBe('BEG');
    expect(leg1.departure.datetime).toMatch(/^2025-10-10T02:55$/);
    expect(leg1.arrival.datetime).toMatch(/^2025-10-10T05:00$/);
    
    // Check second leg: BEG to LJU
    const leg2 = legs[1];
    expect(leg2.flightNumber).toMatch(/^JU \d+$/);
    expect(leg2.departure.iata).toBe('BEG');
    expect(leg2.arrival.iata).toBe('LJU');
    expect(leg2.departure.datetime).toMatch(/^2025-10-10T07:30$/);
    expect(leg2.arrival.datetime).toMatch(/^2025-10-10T09:00$/);
    
    // Check third leg: LJU to BEG
    const leg3 = legs[2];
    expect(leg3.flightNumber).toMatch(/^JU \d+$/);
    expect(leg3.departure.iata).toBe('LJU');
    expect(leg3.arrival.iata).toBe('BEG');
    expect(leg3.departure.datetime).toMatch(/^2025-10-20T14:55$/);
    expect(leg3.arrival.datetime).toMatch(/^2025-10-20T16:20$/);
    
    // Check fourth leg: BEG to SVO
    const leg4 = legs[3];
    expect(leg4.flightNumber).toMatch(/^JU \d+$/);
    expect(leg4.departure.iata).toBe('BEG');
    expect(leg4.arrival.iata).toBe('SVO');
    expect(leg4.departure.datetime).toMatch(/^2025-10-20T17:50$/);
    expect(leg4.arrival.datetime).toMatch(/^2025-10-20T21:55$/);
    
    // Verify all IATA codes are valid
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
    expect(ics).toContain('DTSTART;TZID=');
    expect(ics).toContain('DTEND;TZID=');
  });
   
  test('parses Turkish Airlines ticket correctly', async () => {
    const buf = readFileSync(join(FIXTURES, 'eticket_125177371941_697223835.pdf'));
    const tree = await buildPDFTree(buf.buffer);
    
    expect(tree).toBeDefined();
    expect(tree.type).toBe('document');
    
    const { parser, legs } = parse(tree, lookupIATA);
    console.log(`  [eticket_125177371941_697223835.pdf] parser=${parser}, legs=${legs.length}`);
    
    // Should parse 2 flight legs
    expect(legs.length).toBe(2);
    
    // Check first leg: IST to STN
    const leg1 = legs[0];
    expect(leg1.flightNumber).toMatch(/^TK \d+$/);
    expect(leg1.departure.iata).toBe('IST');
    expect(leg1.arrival.iata).toBe('STN');
    expect(leg1.departure.datetime).toMatch(/^2025-11-20T19:35$/);
    expect(leg1.arrival.datetime).toMatch(/^2025-11-21T00:05$/);
    
    // Check second leg: STN to IST
    const leg2 = legs[1];
    expect(leg2.flightNumber).toMatch(/^TK \d+$/);
    expect(leg2.departure.iata).toBe('STN');
    expect(leg2.arrival.iata).toBe('IST');
    expect(leg2.departure.datetime).toMatch(/^2025-11-24T08:05$/);
    expect(leg2.arrival.datetime).toMatch(/^2025-11-24T08:25$/);
    
    // Verify all IATA codes are valid
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
    expect(ics).toContain('DTSTART;TZID=');
    expect(ics).toContain('DTEND;TZID=');
  });
   
  test('parses Pegasus Airlines ticket correctly', async () => {
    const buf = readFileSync(join(FIXTURES, 'Ticket_SAW_VKO_16_03_2026_SHIRSHOV_DMITRII_.pdf'));
    const tree = await buildPDFTree(buf.buffer);
    
    expect(tree).toBeDefined();
    expect(tree.type).toBe('document');
    
    const { parser, legs } = parse(tree, lookupIATA);
    console.log(`  [Ticket_SAW_VKO_16_03_2026_SHIRSHOV_DMITRII_.pdf] parser=${parser}, legs=${legs.length}`);
    
    // Should parse 1 flight leg
    expect(legs.length).toBe(1);
    
    // Check the leg: SAW to VKO
    const leg1 = legs[0];
    expect(leg1.flightNumber).toMatch(/^PC \d+$/);
    expect(leg1.departure.iata).toBe('SAW');
    expect(leg1.arrival.iata).toBe('VKO');
    expect(leg1.departure.datetime).toMatch(/^2026-03-16T12:15$/);
    expect(leg1.arrival.datetime).toMatch(/^2026-03-16T16:25$/);
    
    // Verify IATA codes are valid
    expect(leg1.departure?.iata).toMatch(/^[A-Z]{3}$/);
    expect(leg1.arrival?.iata).toMatch(/^[A-Z]{3}$/);
    expect(leg1.departure?.datetime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(leg1.arrival?.datetime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(isKnownIATA(leg1.departure.iata)).toBe(true);
    expect(isKnownIATA(leg1.arrival.iata)).toBe(true);
    
    const ics = generateICS(legs, lookupIATA);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).toContain('DTSTART;TZID=');
    expect(ics).toContain('DTEND;TZID=');
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
      const tree = await buildPDFTree(buf.buffer);

      expect(tree).toBeDefined();
      expect(tree.type).toBe('document');

      const { parser, legs } = parse(tree, lookupIATA);
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
