import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '../src/parsers/index.js';
import { lookupIATA } from '../src/airports.js';
import { buildPDFTree } from '../src/extract-pdf-tree.js';

const FIXTURES = join(import.meta.dir, 'fixtures/text');
const PDF_FIXTURES = join(import.meta.dir, 'fixtures');

describe('Parser with text fixtures', () => {
  test('parses Air Serbia itinerary (attachment_1325726d78c16f0faf484dcfae3fc1c9)', () => {
    const text = readFileSync(join(FIXTURES, 'attachment_1325726d78c16f0faf484dcfae3fc1c9.txt'), 'utf-8');
    
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
    
    const { parser, legs } = parse(text, lookupIATA);
    
    console.log(`  [Air Serbia itinerary] parser=${parser}, legs=${legs.length}`);
    
    expect(legs.length).toBe(4);
    
    expect(legs[0].flightNumber).toBe('JU 137');
    expect(legs[0].departure.iata).toBe('SVO');
    expect(legs[0].departure.datetime).toBe('2025-10-10T02:55');
    expect(lookupIATA('SVO').tz).toBe('Europe/Moscow');
    expect(legs[0].arrival.iata).toBe('BEG');
    expect(legs[0].arrival.datetime).toBe('2025-10-10T05:00');
    expect(lookupIATA('BEG').tz).toBe('Europe/Belgrade');
    
    expect(legs[1].flightNumber).toBe('JU 620');
    expect(legs[1].departure.iata).toBe('BEG');
    expect(legs[1].departure.datetime).toBe('2025-10-10T07:30');
    expect(lookupIATA('BEG').tz).toBe('Europe/Belgrade');
    expect(legs[1].arrival.iata).toBe('LJU');
    expect(legs[1].arrival.datetime).toBe('2025-10-10T09:00');
    expect(lookupIATA('LJU').tz).toBe('Europe/Ljubljana');
    
    expect(legs[2].flightNumber).toBe('JU 623');
    expect(legs[2].departure.iata).toBe('LJU');
    expect(legs[2].departure.datetime).toBe('2025-10-20T14:55');
    expect(lookupIATA('LJU').tz).toBe('Europe/Ljubljana');
    expect(legs[2].arrival.iata).toBe('BEG');
    expect(legs[2].arrival.datetime).toBe('2025-10-20T16:20');
    expect(lookupIATA('BEG').tz).toBe('Europe/Belgrade');
    
    expect(legs[3].flightNumber).toBe('JU 134');
    expect(legs[3].departure.iata).toBe('BEG');
    expect(legs[3].departure.datetime).toBe('2025-10-20T17:50');
    expect(lookupIATA('BEG').tz).toBe('Europe/Belgrade');
    expect(legs[3].arrival.iata).toBe('SVO');
    expect(legs[3].arrival.datetime).toBe('2025-10-20T21:55');
    expect(lookupIATA('SVO').tz).toBe('Europe/Moscow');
  });
  
  test('parses Turkish Airlines ticket (eticket_125177371941_697223835)', () => {
    const text = readFileSync(join(FIXTURES, 'eticket_125177371941_697223835.txt'), 'utf-8');
    
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
    
    const { parser, legs } = parse(text, lookupIATA);
    
    console.log(`  [Turkish Airlines ticket] parser=${parser}, legs=${legs.length}`);
    
    expect(legs.length).toBeGreaterThan(0);
    
    for (const leg of legs) {
      expect(leg.flightNumber).toBeTruthy();
      expect(leg.departure.iata).toMatch(/^[A-Z]{3}$/);
      expect(leg.arrival.iata).toMatch(/^[A-Z]{3}$/);
      expect(leg.departure.datetime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      expect(leg.arrival.datetime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      
      expect(lookupIATA(leg.departure.iata)).not.toBeNull();
      expect(lookupIATA(leg.arrival.iata)).not.toBeNull();
    }
  });
  
  test('parses Pegasus Airlines ticket (Ticket_SAW_VKO_16_03_2026_SHIRSHOV_DMITRII_)', async () => {
    const pdfBuffer = readFileSync(join(FIXTURES, '..', 'Ticket_SAW_VKO_16_03_2026_SHIRSHOV_DMITRII_.pdf'));
    const tree = await buildPDFTree(pdfBuffer);
    
    const { parser, legs } = parse(tree, lookupIATA);
    
    console.log(`  [Pegasus Airlines ticket] parser=${parser}, legs=${legs.length}`);
    
    expect(parser).toBe('AviasalesParser');
    expect(legs.length).toBeGreaterThan(0);
    
    for (const leg of legs) {
      expect(leg.flightNumber).toBeTruthy();
      expect(leg.departure.iata).toMatch(/^[A-Z]{3}$/);
      expect(leg.arrival.iata).toMatch(/^[A-Z]{3}$/);
      expect(leg.departure.datetime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      expect(leg.arrival.datetime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      
      expect(lookupIATA(leg.departure.iata)).not.toBeNull();
      expect(lookupIATA(leg.arrival.iata)).not.toBeNull();
    }
  });
});

describe('Parser edge cases and validation', () => {
  test('handles empty text input', () => {
    const { parser, legs } = parse('', lookupIATA);
    
    expect(parser).toBe('GenericParser');
    expect(legs).toEqual([]);
  });
  
  test('handles text with no flight information', () => {
    const text = 'This is just some random text with no flight details.';
    const { parser, legs } = parse(text, lookupIATA);
    
    expect(parser).toBe('GenericParser');
    expect(legs).toEqual([]);
  });
  
  test('handles text with only one airport code', () => {
    const text = 'Flight from JFK airport';
    const { parser, legs } = parse(text, lookupIATA);
    
    expect(parser).toBe('GenericParser');
    expect(legs).toEqual([]);
  });
  
  test('handles text with invalid time format', () => {
    const text = 'Flight JFK to LAX at invalid time';
    const { legs } = parse(text, lookupIATA);
    
    expect(legs).toEqual([]);
  });
  
  test('correctly parses date in various formats', () => {
    const text1 = 'Flight JFK LAX on 25.12.2025 departing 10:30 arriving 13:30';
    const { legs: legs1 } = parse(text1, lookupIATA);
    
    expect(legs1.length).toBe(1);
    expect(legs1[0].departure.datetime).toContain('2025-12-25T10:30');
    
    const text2 = 'Flight JFK LAX 2025-12-25 10:30 13:30';
    const { legs: legs2 } = parse(text2, lookupIATA);
    
    expect(legs2.length).toBe(1);
    expect(legs2[0].departure.datetime).toContain('2025-12-25T10:30');
    
    const text3 = 'Flight JFK LAX on 25 Dec 2025 10:30 13:30';
    const { legs: legs3 } = parse(text3, lookupIATA);
    
    expect(legs3.length).toBe(1);
    expect(legs3[0].departure.datetime).toContain('2025-12-25T10:30');
  });
  
  test('handles overnight flights correctly', () => {
    const text = 'Flight JFK LAX on 25.12.2025 22:30 02:30';
    const { legs } = parse(text, lookupIATA);
    
    expect(legs.length).toBe(1);
    expect(legs[0].departure.datetime).toContain('2025-12-25T22:30');
    expect(legs[0].arrival.datetime).toContain('2025-12-26T02:30');
  });
  
  test('handles Russian month names', () => {
    const text = 'Flight SVO BEG 10 окт 2025 02:55 05:00';
    const { legs } = parse(text, lookupIATA);
    
    expect(legs.length).toBe(1);
    expect(legs[0].departure.datetime).toContain('2025-10-10T02:55');
    expect(legs[0].arrival.datetime).toContain('2025-10-10T05:00');
  });
  
  test('handles flight numbers with and without space', () => {
    const text1 = 'Flight TK1064 LJU STN 20.11.2025 19:35 00:05';
    const { legs: legs1 } = parse(text1, lookupIATA);
    
    expect(legs1.length).toBe(1);
    expect(legs1[0].flightNumber).toBe('TK 1064');
    
    const text2 = 'Flight TK 1064 LJU STN 20.11.2025 19:35 00:05';
    const { legs: legs2 } = parse(text2, lookupIATA);
    
    expect(legs2.length).toBe(1);
    expect(legs2[0].flightNumber).toBe('TK 1064');
  });
  
  test('handles multiple flight legs in sequence', () => {
    const text = `
      Flight JU 137 SVO BEG 10.10.2025 02:55 05:00
      Flight JU 620 BEG LJU 10.10.2025 07:30 09:00
      Flight JU 623 LJU BEG 20.10.2025 14:55 16:20
      Flight JU 134 BEG SVO 20.10.2025 17:50 21:55
    `;
    
    const { legs } = parse(text, lookupIATA);
    
    expect(legs.length).toBe(4);
    expect(legs[0].departure.iata).toBe('SVO');
    expect(legs[0].arrival.iata).toBe('BEG');
    expect(legs[1].departure.iata).toBe('BEG');
    expect(legs[1].arrival.iata).toBe('LJU');
    expect(legs[2].departure.iata).toBe('LJU');
    expect(legs[2].arrival.iata).toBe('BEG');
    expect(legs[3].departure.iata).toBe('BEG');
    expect(legs[3].arrival.iata).toBe('SVO');
  });
  
  test('ignores unknown IATA codes', () => {
    const text = 'Flight XXX YYY on 25.12.2025 10:30 13:30';
    const { legs } = parse(text, lookupIATA);
    
    expect(legs).toEqual([]);
  });
  
  test('handles text with valid and invalid airports', () => {
    const text = 'Flight JFK XXX on 25.12.2025 10:30 13:30';
    const { legs } = parse(text, lookupIATA);
    
    expect(legs).toEqual([]);
  });
});