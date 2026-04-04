import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '../src/parsers/index.js';
import { lookupIATA } from '../src/airports.js';
import { buildPDFTree } from '../src/extract-pdf-tree.js';
import { generateICS } from '../src/ics.js';

const FIXTURES = join(import.meta.dir, 'fixtures');

describe('ICS Generation', () => {
  test('generates valid ICS file for single flight', async () => {
    const pdfBuffer = readFileSync(join(FIXTURES, 'Ticket_SAW_VKO_16_03_2026_SHIRSHOV_DMITRII_.pdf'));
    const tree = await buildPDFTree(pdfBuffer);
    
    const { legs } = parse(tree, lookupIATA);
    
    expect(legs.length).toBeGreaterThan(0);
    
    const icsContent = generateICS(legs, lookupIATA);
    
    expect(icsContent).toBeDefined();
    expect(typeof icsContent).toBe('string');
    
    expect(icsContent).toContain('BEGIN:VCALENDAR');
    expect(icsContent).toContain('END:VCALENDAR');
    expect(icsContent).toContain('VERSION:2.0');
    expect(icsContent).toContain('BEGIN:VEVENT');
    expect(icsContent).toContain('END:VEVENT');
  });

  test('generates ICS file with correct flight information', async () => {
    const pdfBuffer = readFileSync(join(FIXTURES, 'Ticket_SAW_VKO_16_03_2026_SHIRSHOV_DMITRII_.pdf'));
    const tree = await buildPDFTree(pdfBuffer);
    
    const { legs } = parse(tree, lookupIATA);
    const icsContent = generateICS(legs, lookupIATA);
    
    expect(icsContent).toContain('SUMMARY:');
    expect(icsContent).toContain('DTSTART;');
    expect(icsContent).toContain('DTEND;');
    expect(icsContent).toContain('LOCATION:');
    expect(icsContent).toContain('GEO:');
    expect(icsContent).toContain('DESCRIPTION:');
  });

  test('generates ICS file with multiple events for multi-leg flights', async () => {
    const pdfBuffer = readFileSync(join(FIXTURES, 'Ticket_SVO_SVO_30_01_2026_SHIRSHOV_DMITRII_.pdf'));
    const tree = await buildPDFTree(pdfBuffer);
    
    const { legs } = parse(tree, lookupIATA);
    
    expect(legs.length).toBe(2);
    
    const icsContent = generateICS(legs, lookupIATA);
    
    const veventCount = (icsContent.match(/BEGIN:VEVENT/g) || []).length;
    expect(veventCount).toBe(2);
    
    expect(icsContent).toContain('JU 133');
    expect(icsContent).toContain('JU 138');
  });

  test('generates valid ICS datetime format', async () => {
    const pdfBuffer = readFileSync(join(FIXTURES, 'Ticket_SAW_VKO_16_03_2026_SHIRSHOV_DMITRII_.pdf'));
    const tree = await buildPDFTree(pdfBuffer);
    
    const { legs } = parse(tree, lookupIATA);
    const icsContent = generateICS(legs, lookupIATA);
    
    const datetimeRegex = /\d{8}T\d{6}/;
    expect(datetimeRegex.test(icsContent)).toBe(true);
  });

  test('includes correct IATA codes in SUMMARY', async () => {
    const pdfBuffer = readFileSync(join(FIXTURES, 'Ticket_SVO_SVO_30_01_2026_SHIRSHOV_DMITRII_.pdf'));
    const tree = await buildPDFTree(pdfBuffer);
    
    const { legs } = parse(tree, lookupIATA);
    const icsContent = generateICS(legs, lookupIATA);
    
    expect(icsContent).toContain('SVO → BEG');
    expect(icsContent).toContain('BEG → SVO');
  });

  test('generates ICS file with proper line endings', async () => {
    const pdfBuffer = readFileSync(join(FIXTURES, 'Ticket_SAW_VKO_16_03_2026_SHIRSHOV_DMITRII_.pdf'));
    const tree = await buildPDFTree(pdfBuffer);
    
    const { legs } = parse(tree, lookupIATA);
    const icsContent = generateICS(legs, lookupIATA);
    
    expect(icsContent).toContain('\r\n');
    expect(icsContent.endsWith('\r\n')).toBe(true);
  });

  test('handles empty legs array gracefully', async () => {
    const icsContent = generateICS([], lookupIATA);
    
    expect(icsContent).toContain('BEGIN:VCALENDAR');
    expect(icsContent).toContain('END:VCALENDAR');
    expect(icsContent).not.toContain('BEGIN:VEVENT');
  });

  test('handles legs with unknown airport codes gracefully', async () => {
    const legs = [
      {
        flightNumber: 'TK 123',
        departure: { iata: 'UNKNOWN', datetime: '2026-01-01T12:00', terminal: 'A' },
        arrival: { iata: 'IST', datetime: '2026-01-01T15:00', terminal: 'B' },
        airline: null,
        passenger: null,
        bookingRef: null,
        seat: null,
        class: null,
      },
    ];
    
    const icsContent = generateICS(legs, lookupIATA);
    
    expect(icsContent).not.toContain('UNKNOWN → IST');
  });

  test('generates unique UIDs for each event', async () => {
    const pdfBuffer = readFileSync(join(FIXTURES, 'Ticket_SVO_SVO_30_01_2026_SHIRSHOV_DMITRII_.pdf'));
    const tree = await buildPDFTree(pdfBuffer);
    
    const { legs } = parse(tree, lookupIATA);
    const icsContent = generateICS(legs, lookupIATA);
    
    const uidMatches = icsContent.match(/UID:[^\r\n]+/g) || [];
    const uids = uidMatches.map(m => m.replace('UID:', ''));
    
    expect(uids.length).toBeGreaterThan(0);
    
    const uniqueUids = new Set(uids);
    expect(uniqueUids.size).toBe(uids.length);
  });

  test('includes timezone information', async () => {
    const pdfBuffer = readFileSync(join(FIXTURES, 'Ticket_SAW_VKO_16_03_2026_SHIRSHOV_DMITRII_.pdf'));
    const tree = await buildPDFTree(pdfBuffer);
    
    const { legs } = parse(tree, lookupIATA);
    const icsContent = generateICS(legs, lookupIATA);
    
    expect(icsContent).toContain('TZID=');
    expect(icsContent).toContain('Europe/Istanbul');
    expect(icsContent).toContain('Europe/Moscow');
  });

  test('generates DESCRIPTION with flight details', async () => {
    const pdfBuffer = readFileSync(join(FIXTURES, 'Ticket_SAW_VKO_16_03_2026_SHIRSHOV_DMITRII_.pdf'));
    const tree = await buildPDFTree(pdfBuffer);
    
    const { legs } = parse(tree, lookupIATA);
    const icsContent = generateICS(legs, lookupIATA);
    
    expect(icsContent).toContain('Flight: PC 388');
    expect(icsContent).toContain('Departure terminal:');
    expect(icsContent).toContain('Arrival terminal:');
  });
});