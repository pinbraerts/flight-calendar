import { mkdir, writeFile } from 'node:fs/promises';

const SOURCE =
  'https://raw.githubusercontent.com/mwgg/Airports/master/airports.json';

const raw = await fetch(SOURCE).then(r => r.json());

const out = {};
for (const entry of Object.values(raw)) {
  const iata = entry.iata?.trim();
  if (!iata || iata === '0' || iata.length !== 3) continue;
  out[iata.toUpperCase()] = {
    name:    entry.name,
    city:    entry.city,
    country: entry.country,
    lat:     entry.lat,
    lon:     entry.lon,
    tz:      entry.tz,
  };
}

await mkdir('data', { recursive: true });
await writeFile('data/airports.json', JSON.stringify(out, null, 2), 'utf8');
console.log(`Written ${Object.keys(out).length} IATA airports to data/airports.json`);
