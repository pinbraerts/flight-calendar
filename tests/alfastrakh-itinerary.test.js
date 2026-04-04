import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '../src/parsers/index.js';
import { lookupIATA } from '../src/airports.js';

const FIXTURES = join(import.meta.dir, 'fixtures/text');

describe('Alfastrakh Itinerary Parser', () => {
  test('parses Turkish Airlines itinerary (itinerary_654da3a6b84762c9fb2729a2c2ef4d3c_F6AU2D)', () => {
    const text = readFileSync(join(FIXTURES, 'itinerary_654da3a6b84762c9fb2729a2c2ef4d3c_F6AU2D.txt'), 'utf-8');
    
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
    
    const { parser, legs } = parse(text, lookupIATA);
    
    console.log(`  [Turkish Airlines itinerary] parser=${parser}, legs=${legs.length}`);
    
    expect(parser).toBe('AlfastrakhItineraryParser');
    expect(legs.length).toBe(1);
    
    const leg = legs[0];
    
    expect(leg.flightNumber).toBe('TK 353');
    expect(leg.airline).toBe('Turkish Airlines');
    expect(leg.passenger).toBe('SHIRSHOV DMITRII');
    expect(leg.bookingRef).toBe('UHJY4Y');
    
    expect(leg.departure.iata).toBe('ALA');
    expect(leg.departure.datetime).toBe('2026-02-12T15:00');
    expect(leg.departure.terminal).toBeNull();
   expect(lookupIATA('ALA').tz).toBe('Asia/Almaty');
    
    expect(leg.arrival.iata).toBe('IST');
    expect(leg.arrival.datetime).toBe('2026-02-12T10:50');
    expect(leg.arrival.terminal).toBeNull();
    expect(lookupIATA('IST').tz).toBe('Europe/Istanbul');
    
    expect(leg.seat).toBeNull();
    expect(leg.class).toBe('T');
  });
  
  test('parses Aeroflot round-trip itinerary (itinerary_d0aa43f7a99e058bfbd6a70bf8aceffe_94W20P)', () => {
    const text = readFileSync(join(FIXTURES, 'itinerary_d0aa43f7a99e058bfbd6a70bf8aceffe_94W20P.txt'), 'utf-8');
    
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
    
    const { parser, legs } = parse(text, lookupIATA);
    
    console.log(`  [Aeroflot round-trip itinerary] parser=${parser}, legs=${legs.length}`);
    
    expect(parser).toBe('AlfastrakhItineraryParser');
    expect(legs.length).toBe(2);
    
    const leg1 = legs[0];
    
    expect(leg1.flightNumber).toBe('SU 2138');
    expect(leg1.airline).toBe('Аэрофлот');
    expect(leg1.passenger).toBe('SHIRSHOV DMITRII');
    expect(leg1.bookingRef).toBe('94W20P');
    
    expect(leg1.departure.iata).toBe('SVO');
    expect(leg1.departure.datetime).toBe('2026-03-13T23:30');
    expect(leg1.departure.terminal).toBe('C');
    expect(lookupIATA('SVO').tz).toBe('Europe/Moscow');
    
    expect(leg1.arrival.iata).toBe('IST');
    expect(leg1.arrival.datetime).toBe('2026-03-13T18:15');
    expect(leg1.arrival.terminal).toBeNull();
    expect(lookupIATA('IST').tz).toBe('Europe/Istanbul');
    
    expect(leg1.seat).toBeNull();
    expect(leg1.class).toBe('V');
    
    const leg2 = legs[1];
    
    expect(leg2.flightNumber).toBe('SU 2135');
    expect(leg2.airline).toBe('Аэрофлот');
    expect(leg2.passenger).toBe('SHIRSHOV DMITRII');
    expect(leg2.bookingRef).toBe('94W20P');
    
    expect(leg2.departure.iata).toBe('IST');
    expect(leg2.departure.datetime).toBe('2026-03-16T13:20');
    expect(leg2.departure.terminal).toBeNull();
    expect(lookupIATA('IST').tz).toBe('Europe/Istanbul');
    
    expect(leg2.arrival.iata).toBe('SVO');
    expect(leg2.arrival.datetime).toBe('2026-03-16T08:45');
    expect(leg2.arrival.terminal).toBe('C');
    expect(lookupIATA('SVO').tz).toBe('Europe/Moscow');
    
    expect(leg2.seat).toBeNull();
    expect(leg2.class).toBe('G');
  });
  
  test('detects non-itinerary text correctly', () => {
    const text = 'Some random text that is not a flight ticket';
    
    const { parser } = parse(text, lookupIATA);
    
    expect(parser).toBe('none');
  });
});
