import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '../src/parsers/index.js';
import { lookupIATA } from '../src/airports.js';
import { buildPDFTree } from '../src/extract-pdf-tree.js';

const FIXTURES = join(import.meta.dir, 'fixtures');

describe('Alfastrakh tree-based parser with PDF fixtures', () => {
  test('parses original Air Serbia itinerary (attachment_1325726d78c16f0faf484dcfae3fc1c9)', async () => {
    const pdfBuffer = readFileSync(join(FIXTURES, 'attachment_1325726d78c16f0faf484dcfae3fc1c9.pdf'));
    const tree = await buildPDFTree(pdfBuffer);
    
    expect(tree).toBeDefined();
    expect(tree.type).toBe('document');
    
    const { parser, legs } = parse(tree, lookupIATA);
    
    console.log(`  [Air Serbia itinerary] parser=${parser}, legs=${legs.length}`);
    
    expect(parser).toBe('AlfastrakhParser');
    expect(legs.length).toBe(4);
    
    expect(legs[0].flightNumber).toBe('JU 137');
    expect(legs[0].departure.iata).toBe('SVO');
    expect(legs[0].departure.datetime).toBe('2025-10-10T02:55');
    expect(legs[0].arrival.iata).toBe('BEG');
    expect(legs[0].arrival.datetime).toBe('2025-10-10T05:00');
    
    expect(legs[1].flightNumber).toBe('JU 620');
    expect(legs[1].departure.iata).toBe('BEG');
    expect(legs[1].arrival.datetime).toBe('2025-10-10T09:00');
    
    expect(legs[3].flightNumber).toBe('JU 134');
    expect(legs[3].departure.iata).toBe('BEG');
    expect(legs[3].departure.datetime).toBe('2025-10-20T17:50');
  });

  test('parses Aeroflot ticket (attachment_17909a9f3fe6bffd90df1bdd42b39762)', async () => {
    const pdfBuffer = readFileSync(join(FIXTURES, 'attachment_17909a9f3fe6bffd90df1bdd42b39762.pdf'));
    const tree = await buildPDFTree(pdfBuffer);
    
    const { parser, legs } = parse(tree, lookupIATA);
    
    console.log(`  [Aeroflot ticket] parser=${parser}, legs=${legs.length}`);
    
    expect(parser).toBe('AlfastrakhParser');
    expect(legs.length).toBe(1);
    
    expect(legs[0].flightNumber).toBe('SU 2138');
    expect(legs[0].departure.iata).toBe('SVO');
    expect(legs[0].departure.datetime).toBe('2025-08-29T23:30');
    expect(legs[0].arrival.iata).toBe('IST');
    expect(legs[0].arrival.datetime).toBe('2025-08-30T04:35');
  });

  test('parses Turkish Airlines ticket (attachment_5bfe0988a73408344fe97aec1dd55123)', async () => {
    const pdfBuffer = readFileSync(join(FIXTURES, 'attachment_5bfe0988a73408344fe97aec1dd55123.pdf'));
    const tree = await buildPDFTree(pdfBuffer);
    
    const { parser, legs } = parse(tree, lookupIATA);
    
    console.log(`  [Turkish Airlines ticket] parser=${parser}, legs=${legs.length}`);
    
    expect(parser).toBe('AlfastrakhParser');
    expect(legs.length).toBe(1);
    
    expect(legs[0].flightNumber).toBe('TK 1079');
    expect(legs[0].departure.iata).toBe('IST');
    expect(legs[0].arrival.iata).toBe('BEG');
    expect(legs[0].departure.datetime).toBe('2025-08-30T14:20');
  });

  test('parses Air Serbia ticket (attachment_665189cb5866162624aa14324534e676)', async () => {
    const pdfBuffer = readFileSync(join(FIXTURES, 'attachment_665189cb5866162624aa14324534e676.pdf'));
    const tree = await buildPDFTree(pdfBuffer);
    
    const { parser, legs } = parse(tree, lookupIATA);
    
    console.log(`  [Air Serbia ticket] parser=${parser}, legs=${legs.length}`);
    
    expect(parser).toBe('AlfastrakhParser');
    expect(legs.length).toBe(1);
    
    expect(legs[0].flightNumber).toBe('JU 130');
    expect(legs[0].departure.iata).toBe('BEG');
    expect(legs[0].arrival.iata).toBe('SVO');
    expect(legs[0].departure.datetime).toBe('2025-09-03T05:50');
  });

  test('parses Pegasus Airlines ticket (attachment_c722f16c84554406298f0a5692b6f556)', async () => {
    const pdfBuffer = readFileSync(join(FIXTURES, 'attachment_c722f16c84554406298f0a5692b6f556.pdf'));
    const tree = await buildPDFTree(pdfBuffer);
    
    const { parser, legs } = parse(tree, lookupIATA);
    
    console.log(`  [Pegasus Airlines ticket] parser=${parser}, legs=${legs.length}`);
    
    expect(parser).toBe('AlfastrakhParser');
    expect(legs.length).toBe(1);
    
    expect(legs[0].flightNumber).toBe('PC 7121');
    expect(legs[0].departure.iata).toBe('SAW');
    expect(legs[0].arrival.iata).toBe('BEG');
    expect(legs[0].departure.datetime).toBe('2025-08-30T08:40');
  });
  
  test('parses Aviasales Pegasus ticket (Ticket_SAW_VKO_16_03_2026_SHIRSHOV_DMITRII_)', async () => {
    const pdfBuffer = readFileSync(join(FIXTURES, 'Ticket_SAW_VKO_16_03_2026_SHIRSHOV_DMITRII_.pdf'));
    const tree = await buildPDFTree(pdfBuffer);
    
    const { parser, legs } = parse(tree, lookupIATA);
    
    console.log(`  [Aviasales Pegasus] parser=${parser}, legs=${legs.length}`);
    
    expect(parser).toBe('AviasalesParser');
    expect(legs.length).toBe(1);
    
    expect(legs[0].flightNumber).toBe('PC 388');
    expect(legs[0].departure.iata).toBe('SAW');
    expect(legs[0].arrival.iata).toBe('VKO');
    expect(legs[0].departure.datetime).toBe('2026-03-16T12:15');
    expect(legs[0].arrival.datetime).toBe('2026-03-16T16:25');
  });
  
  test('handles non-Alfastrakh PDFs appropriately', async () => {
    const pdfBuffer = readFileSync(join(FIXTURES, 'eticket_125177371941_697223835.pdf'));
    const tree = await buildPDFTree(pdfBuffer);
    
    const { parser, legs } = parse(tree, lookupIATA);
    
    console.log(`  [Aviakassa Turkish Airlines] parser=${parser}, legs=${legs.length}`);
    
    expect(parser).toBe('AviakassaParser');
    expect(legs.length).toBe(0);
  });

  test('parses Aviakassa ticket (attachment_08c61bc01c844291b5c5b2fcf02d94f1)', async () => {
    const pdfBuffer = readFileSync(join(FIXTURES, 'attachment_08c61bc01c844291b5c5b2fcf02d94f1.pdf'));
    const tree = await buildPDFTree(pdfBuffer);
    
    const { parser, legs } = parse(tree, lookupIATA);
    
    console.log(`  [Aviakassa ticket] parser=${parser}, legs=${legs.length}`);
    
    expect(parser).toBe('AviakassaParser');
    expect(legs.length).toBe(4);
    
    expect(legs[0].flightNumber).toBe('TK 420');
    expect(legs[0].airline).toBe('Turkish Airlines');
    expect(legs[0].departure.iata).toBe('VKO');
    expect(legs[0].departure.datetime).toBe('2026-04-17T06:25');
    expect(legs[0].arrival.iata).toBe('IST');
    expect(legs[0].arrival.datetime).toBe('2026-04-17T10:20');
    
    expect(legs[1].flightNumber).toBe('TK 1033');
    expect(legs[1].airline).toBe('Turkish Airlines');
    expect(legs[1].departure.iata).toBe('IST');
    expect(legs[1].departure.datetime).toBe('2026-04-17T12:20');
    expect(legs[1].arrival.iata).toBe('BUD');
    expect(legs[1].arrival.datetime).toBe('2026-04-17T13:15');
    
    expect(legs[2].flightNumber).toBe('TK 1038');
    expect(legs[2].airline).toBe('Turkish Airlines');
    expect(legs[2].departure.iata).toBe('BUD');
    expect(legs[2].departure.datetime).toBe('2026-04-26T20:30');
    expect(legs[2].arrival.iata).toBe('IST');
    expect(legs[2].arrival.datetime).toBe('2026-04-26T23:40');
    
    expect(legs[3].flightNumber).toBe('TK 419');
    expect(legs[3].airline).toBe('Turkish Airlines');
    expect(legs[3].departure.iata).toBe('IST');
    expect(legs[3].departure.datetime).toBe('2026-04-27T01:05');
    expect(legs[3].arrival.iata).toBe('VKO');
    expect(legs[3].arrival.datetime).toBe('2026-04-27T05:00');
  });
});

describe('Tree-based parser edge cases', () => {
  test('handles non-tree input gracefully', () => {
    const text = 'Some random text';
    const { parser, legs } = parse(text, lookupIATA);
    
    expect(parser).toBe('none');
    expect(legs).toEqual([]);
  });
  
  test('handles empty tree', () => {
    const emptyTree = { type: 'document', children: [], pages: [] };
    const { parser, legs } = parse(emptyTree, lookupIATA);
    
    expect(parser).toBe('none');
    expect(legs).toEqual([]);
  });
  
  test('handles tree without flight data', async () => {
    const simpleTree = { 
      type: 'document', 
      children: [], 
      pages: [
        {
          type: 'page',
          metadata: { pageNumber: 1 },
          children: [
            {
              type: 'line',
              bbox: { x: 0, y: 100, width: 100, height: 20 },
              children: [
                { type: 'text', text: 'No flight data', metadata: { fontSize: 12, fontFamily: 'g_d0_f1' } }
              ]
            }
          ]
        }
      ]
    };
    
    const { parser, legs } = parse(simpleTree, lookupIATA);
    
    expect(parser).toBe('none');
    expect(legs).toEqual([]);
  });
});