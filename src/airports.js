import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const raw   = readFileSync(join(__dir, '../data/airports.json'), 'utf8');

/** @type {Record<string, {name:string, city:string, country:string, lat:number, lon:number, tz:string}>} */
const DB = JSON.parse(raw);

/**
 * @param {string} iata  3-letter IATA code, case-insensitive
 * @returns {{ name, city, country, lat, lon, tz } | null}
 */
export function lookupIATA(iata) {
  return DB[iata?.toUpperCase()] ?? null;
}

/** Returns true if iata is a known airport code */
export function isKnownIATA(iata) {
  return iata?.toUpperCase() in DB;
}
