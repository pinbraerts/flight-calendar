import { AlfastrakhParser } from './tree-based-font-geo.js';
import { AviasalesParser } from './aviasales.js';
import { AlfastrakhItineraryParser } from './alfastrakh-itinerary.js';
import { AviakassaParser } from './aviakassa.js';

const PARSERS = [
  new AviasalesParser(),
  new AlfastrakhParser(),
  new AlfastrakhItineraryParser(),
  new AviakassaParser(),
];

export function parse(text, airportLookup) {
  for (const parser of PARSERS) {
    if (parser.canParse(text)) {
      return { parser: parser.name, legs: parser.parse(text, airportLookup) };
    }
  }
  return { parser: 'none', legs: [] };
}
