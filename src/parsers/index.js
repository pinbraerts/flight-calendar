import { GenericParser } from './generic.js';

const PARSERS = [
  new GenericParser(),
];

/**
 * Detect which parser handles this text and run it.
 * @param {string} text
 * @param {(iata: string) => object|null} airportLookup
 * @returns {{ parser: string, legs: import('./base.js').FlightLeg[] }}
 */
export function parse(text, airportLookup) {
  for (const parser of PARSERS) {
    if (parser.canParse(text)) {
      return { parser: parser.name, legs: parser.parse(text, airportLookup) };
    }
  }
  return { parser: 'none', legs: [] };
}
