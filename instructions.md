# AGENT.md — Flight Calendar Tool

## Purpose

A local, browser-based tool that reads a flight itinerary PDF, parses the flight
legs (departure/arrival IATA codes, local datetimes), looks up airport timezones
and coordinates from a bundled static dataset, and produces a downloadable `.ics`
calendar file with correct per-leg timezones. Also runnable as a Bun CLI script
for testing without a browser.

---

## Stack & Constraints

| Concern            | Decision                                                      |
|--------------------|---------------------------------------------------------------|
| Runtime            | Bun (v1.3+)                                                   |
| Package manager    | Bun (`bun add`)                                               |
| Module format      | ESM throughout (`"type": "module"` in package.json)          |
| Only npm dep       | `pdfjs-dist` (PDF text extraction)                           |
| Frameworks         | None                                                          |
| Airport data       | Static preprocessed JSON committed to repo (no runtime fetch) |
| ICS generation     | Pure JS string templating, no library                         |
| Itinerary parsing  | Hardcoded heuristic functions, no LLM                         |
| Dev server         | Bun built-in HTTP server (`server.js`)                        |
| Tests              | `bun test`, real PDF fixtures in `tests/fixtures/`           |

---

## Project Structure

```
flight-calendar/
├── AGENT.md
├── package.json
├── bun.lockb
│
├── data/
│   └── airports.json              # preprocessed IATA-keyed airport data, committed to repo
│
├── scripts/
│   └── preprocess-airports.js    # one-time script: fetch mwgg/Airports → write data/airports.json
│
├── src/
│   ├── extract-pdf.js            # PDF → raw text string, works in Bun and browser
│   ├── airports.js               # loads data/airports.json, exports lookupIATA(code)
│   ├── ics.js                    # generateICS(legs[]) → ICS string
│   ├── cli.js                    # Bun CLI entry: bun src/cli.js <path.pdf>
│   └── parsers/
│       ├── index.js              # parser registry: detectParser(text), parse(text)
│       ├── base.js               # FlightParser base class (interface definition)
│       └── generic.js           # GenericParser: heuristic fallback, always last
│
├── web/
│   ├── index.html                # single-file browser UI, no framework
│   └── app.js                    # browser entry point, imports from src/
│
├── server.js                     # dev server: `bun server.js` → http://localhost:3000
│
└── tests/
    ├── fixtures/                 # put real PDF files here (gitignore large ones if needed)
    └── extraction.test.js        # bun test
```

---

## Step 0 — Initial Setup

```bash
mkdir flight-calendar && cd flight-calendar
bun init -y                        # creates package.json
bun add pdfjs-dist
```

Edit `package.json` to ensure:

```json
{
  "name": "flight-calendar",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "preprocess": "bun scripts/preprocess-airports.js",
    "dev":        "bun server.js",
    "test":       "bun test",
    "cli":        "bun src/cli.js"
  },
  "dependencies": {
    "pdfjs-dist": "^5.0.0"
  }
}
```

---

## Step 1 — Airport Data (`scripts/preprocess-airports.js`)

**Run once**, output is committed. Never called at runtime.

```js
// scripts/preprocess-airports.js
// Usage: bun scripts/preprocess-airports.js
// Fetches mwgg/Airports raw JSON (ICAO-keyed, ~28k entries) and writes a
// filtered IATA-keyed subset to data/airports.json.

import { mkdir, writeFile } from 'node:fs/promises';

const SOURCE =
  'https://raw.githubusercontent.com/mwgg/Airports/master/airports.json';

const raw = await fetch(SOURCE).then(r => r.json());

// Input shape per entry (ICAO-keyed):
// { icao, iata, name, city, state, country, elevation, lat, lon, tz }
//
// Output shape (IATA-keyed), keep only what the app needs:
// { name, city, country, lat, lon, tz }

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
    tz:      entry.tz,       // IANA tz string, e.g. "America/New_York"
  };
}

await mkdir('data', { recursive: true });
await writeFile('data/airports.json', JSON.stringify(out, null, 2), 'utf8');
console.log(`Written ${Object.keys(out).length} IATA airports to data/airports.json`);
```

After running, `data/airports.json` looks like:
```json
{
  "JFK": { "name": "John F Kennedy Intl", "city": "New York", "country": "US",
           "lat": 40.63972, "lon": -73.77889, "tz": "America/New_York" },
  "SVO": { "name": "Sheremetyevo", "city": "Moscow", "country": "RU",
           "lat": 55.97250, "lon": 37.41472, "tz": "Europe/Moscow" }
}
```

**Commit `data/airports.json` to the repo. Do not re-fetch at runtime.**

---

## Step 2 — Airport Lookup (`src/airports.js`)

```js
// src/airports.js
// Synchronously loads data/airports.json relative to this file.
// Works in both Bun and browser (browser uses a fetch in app.js instead).

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
```

> **Browser note**: `app.js` (browser entry) must not import this file directly because
> `node:fs` is unavailable in the browser. Instead, `app.js` does
> `const DB = await fetch('/data/airports.json').then(r => r.json())` once on load and
> passes the lookup function down to parsers. See Step 7.

---

## Step 3 — PDF Text Extraction (`src/extract-pdf.js`)

This module works **identically in Bun and in the browser** — the only difference
is how you supply the PDF bytes and how you set `workerSrc`.

```js
// src/extract-pdf.js
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

/**
 * Call this once before any extraction.
 * In Bun/Node: pass workerSrc = null (uses fake synchronous worker).
 * In browser:  pass workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs'
 */
export function configurePDFWorker(workerSrc) {
  GlobalWorkerOptions.workerSrc = workerSrc ?? '';
}

/**
 * Extract all text from a PDF.
 * @param {ArrayBuffer} buffer  Raw PDF bytes
 * @returns {Promise<string>}   All text joined by newlines, one entry per page
 */
export async function extractTextFromPDF(buffer) {
  const loadingTask = getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;

  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Each item has a `str` field; join with space, preserve line breaks via
    // items that have `hasEOL: true`
    const pageText = content.items
      .map(item => item.str + (item.hasEOL ? '\n' : ' '))
      .join('');
    pages.push(pageText);
  }

  return pages.join('\n--- PAGE BREAK ---\n');
}
```

> **Important**: After `bun add pdfjs-dist`, verify the worker file path:
> ```bash
> ls node_modules/pdfjs-dist/build/pdf.worker.mjs
> ```
> If the path differs (e.g. `pdf.worker.min.mjs`), update the path in `server.js`
> and `web/app.js` accordingly.

---

## Step 4 — Data Structures (shared types, no TypeScript)

Define these shapes via JSDoc comments. Use them consistently everywhere.

```js
/**
 * @typedef {{
 *   iata:     string,          // e.g. "SVO"
 *   datetime: string,          // ISO local: "2025-06-01T10:00" (NO timezone suffix)
 *   terminal: string|null,
 * }} FlightEndpoint
 *
 * @typedef {{
 *   flightNumber: string,      // e.g. "SU 1234"
 *   airline:      string|null,
 *   departure:    FlightEndpoint,
 *   arrival:      FlightEndpoint,
 *   passenger:    string|null, // e.g. "IVANOV IVAN"
 *   bookingRef:   string|null, // e.g. "ABC123"
 *   seat:         string|null, // e.g. "14A"
 *   class:        string|null, // e.g. "Economy"
 * }} FlightLeg
 */
```

---

## Step 5 — Parser Architecture (`src/parsers/`)

### `src/parsers/base.js`

```js
// src/parsers/base.js
export class FlightParser {
  /** Human-readable name shown in debug output */
  get name() { return 'BaseParser'; }

  /**
   * Return true if this parser recognises the extracted text.
   * Called in order on all registered parsers; first match wins.
   * @param {string} text
   * @returns {boolean}
   */
  canParse(text) { return false; }   // eslint-disable-line no-unused-vars

  /**
   * Parse text into flight legs. Only called when canParse() returned true.
   * @param {string} text
   * @param {(iata: string) => object|null} airportLookup
   * @returns {FlightLeg[]}
   */
  parse(text, airportLookup) { return []; }  // eslint-disable-line no-unused-vars
}
```

### `src/parsers/generic.js`

The generic parser is a best-effort heuristic fallback. It must:

1. **Find IATA candidates**: scan for `\b[A-Z]{3}\b` tokens, keep only those
   validated by `isKnownIATA()` (filters out "AND", "THE", etc.)
2. **Find datetime candidates**: scan for common date+time patterns (see regexes below)
3. **Find flight number candidates**: `\b[A-Z]{2}\s?\d{1,4}\b`
4. **Pair endpoints**: heuristically pair consecutive IATA codes that co-occur
   close to a date+time string in the text buffer
5. Return `FlightLeg[]`

Key regexes to implement:
```js
// Dates
const DATE_PATTERNS = [
  /\b(\d{2})\.(\d{2})\.(\d{4})\b/,          // DD.MM.YYYY  (Russian)
  /\b(\d{4})-(\d{2})-(\d{2})\b/,            // YYYY-MM-DD
  /\b(\d{2})\/(\d{2})\/(\d{4})\b/,          // DD/MM/YYYY
  /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|  // DD Mon YYYY (en)
       jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})\b/i,
  /\b(\d{1,2})\s+(янв|фев|мар|апр|май|июн|  // DD Mon YYYY (ru)
       июл|авг|сен|окт|ноя|дек)[а-я]*\s+(\d{4})\b/i,
];

// Times
const TIME_RE = /\b(\d{2}):(\d{2})\b/;

// Flight numbers
const FLIGHT_NO_RE = /\b([A-Z]{2})\s?(\d{1,4})\b/g;
```

All date patterns must normalise to `YYYY-MM-DDTHH:MM` local ISO strings.

### `src/parsers/index.js`

```js
// src/parsers/index.js
import { GenericParser } from './generic.js';

// Add airline-specific parsers here as they are written, before GenericParser
const PARSERS = [
  // new AeroflotParser(),
  // new LufthansaParser(),
  new GenericParser(),   // must always be last
];

/**
 * Detect which parser handles this text and run it.
 * @param {string} text
 * @param {(iata: string) => object|null} airportLookup
 * @returns {{ parser: string, legs: FlightLeg[] }}
 */
export function parse(text, airportLookup) {
  for (const parser of PARSERS) {
    if (parser.canParse(text)) {
      return { parser: parser.name, legs: parser.parse(text, airportLookup) };
    }
  }
  return { parser: 'none', legs: [] };
}
```

---

## Step 6 — ICS Generation (`src/ics.js`)

### RFC 5545 rules to implement

| Rule | Detail |
|------|--------|
| Line endings | `\r\n` (CRLF), never `\n` |
| Line folding | Max 75 octets per line; fold with `\r\n ` (CRLF + single SPACE) |
| Datetime format | `DTSTART;TZID=America/New_York:20250601T100000` — **local time, no Z** |
| Separate TZs | `DTSTART` and `DTEND` each carry their own `TZID=` independently |
| UID | `crypto.randomUUID() + "@flight-calendar"` |
| No VTIMEZONE | Major apps (Google, Apple, Outlook) accept bare `TZID=` without embedded VTIMEZONE block |

```js
// src/ics.js

const CRLF = '\r\n';

/** Fold a single content line to max 75 octets per RFC 5545 §3.1 */
function foldLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const chars = [...line];   // handle multibyte correctly
  let out = '';
  let currentLine = '';
  for (const ch of chars) {
    const candidate = currentLine + ch;
    if (enc.encode(candidate).length > 75) {
      out += currentLine + CRLF + ' ';
      currentLine = ch;
    } else {
      currentLine = candidate;
    }
  }
  return out + currentLine;
}

/** Format a local datetime string "2025-06-01T10:00" to ICS "20250601T100000" */
function toICSDateTime(isoLocal) {
  return isoLocal.replace(/[-:]/g, '').replace('T', 'T').slice(0, 15).padEnd(15, '0');
}

/**
 * @param {FlightLeg[]} legs
 * @param {(iata: string) => object|null} airportLookup
 * @returns {string}  Complete .ics file content
 */
export function generateICS(legs, airportLookup) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FlightCalendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const leg of legs) {
    const dep = airportLookup(leg.departure.iata);
    const arr = airportLookup(leg.arrival.iata);

    if (!dep || !arr) {
      console.warn(`Unknown airport: ${leg.departure.iata} or ${leg.arrival.iata}, skipping leg`);
      continue;
    }

    const uid         = crypto.randomUUID() + '@flight-calendar';
    const summary     = `${leg.flightNumber}: ${leg.departure.iata} → ${leg.arrival.iata}`;
    const depDT       = toICSDateTime(leg.departure.datetime);
    const arrDT       = toICSDateTime(leg.arrival.datetime);
    const geoStr      = `${dep.lat.toFixed(6)};${dep.lon.toFixed(6)}`;
    const location    = `${dep.name}, ${dep.city}`;

    const descParts   = [
      leg.flightNumber && `Flight: ${leg.flightNumber}`,
      leg.bookingRef   && `Booking: ${leg.bookingRef}`,
      leg.passenger    && `Passenger: ${leg.passenger}`,
      leg.seat         && `Seat: ${leg.seat}`,
      leg.class        && `Class: ${leg.class}`,
      `Departure terminal: ${leg.departure.terminal ?? 'n/a'}`,
      `Arrival terminal:   ${leg.arrival.terminal ?? 'n/a'}`,
    ].filter(Boolean).join('\\n');

    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `SEQUENCE:0`,
      `STATUS:CONFIRMED`,
      `SUMMARY:${summary}`,
      // Different TZID per endpoint — the key feature
      `DTSTART;TZID=${dep.tz}:${depDT}`,
      `DTEND;TZID=${arr.tz}:${arrDT}`,
      `LOCATION:${location}`,
      `GEO:${geoStr}`,
      `DESCRIPTION:${descParts}`,
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');

  return lines.map(foldLine).join(CRLF) + CRLF;
}
```

---

## Step 7 — Dev Server (`server.js`)

```js
// server.js
// Run: bun server.js
// Opens: http://localhost:3000

import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

const PORT = 3000;
const ROOT = import.meta.dir;   // project root

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript',
  '.mjs':  'text/javascript',
  '.json': 'application/json',
  '.pdf':  'application/pdf',
  '.css':  'text/css',
};

function mime(path) {
  const ext = path.match(/\.[^.]+$/)?.[0] ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url      = new URL(req.url);
    let   pathname = url.pathname === '/' ? '/web/index.html' : url.pathname;
    const filePath = join(ROOT, pathname);

    try {
      const body = await readFile(filePath);
      return new Response(body, {
        headers: { 'Content-Type': mime(pathname) },
      });
    } catch {
      return new Response('404 Not Found', { status: 404 });
    }
  },
});

console.log(`Serving at http://localhost:${PORT}`);
```

The server serves `node_modules/` as-is so the browser can load:
- `/node_modules/pdfjs-dist/build/pdf.mjs`
- `/node_modules/pdfjs-dist/build/pdf.worker.mjs`

---

## Step 8 — Browser UI (`web/index.html` + `web/app.js`)

### `web/index.html`

Single HTML file, no framework. Rough structure:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Flight → Calendar</title>
  <style>
    /* minimal styles: drop zone, table, button */
  </style>
</head>
<body>
  <h1>Flight → Calendar</h1>

  <!-- Step 1: PDF input -->
  <div id="drop-zone">
    Drop PDF here or <label for="pdf-input">choose file</label>
    <input type="file" id="pdf-input" accept=".pdf" style="display:none">
  </div>

  <!-- Step 2: Editable detected legs -->
  <section id="results" hidden>
    <p id="parser-used"></p>
    <table id="legs-table">
      <thead>
        <tr>
          <th>Flight</th>
          <th>From (IATA)</th>
          <th>Dep. datetime (local)</th>
          <th>To (IATA)</th>
          <th>Arr. datetime (local)</th>
          <th>Booking ref</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
    <button id="add-leg">+ Add leg</button>
    <button id="download-ics">⬇ Download .ics</button>
  </section>

  <!-- Step 3: Warnings/errors -->
  <pre id="log"></pre>

  <script type="module" src="/web/app.js"></script>
</body>
</html>
```

### `web/app.js`

```js
// web/app.js
import { getDocument, GlobalWorkerOptions } from '/node_modules/pdfjs-dist/build/pdf.mjs';
import { extractTextFromPDF, configurePDFWorker } from '/src/extract-pdf.js';
import { parse }        from '/src/parsers/index.js';
import { generateICS }  from '/src/ics.js';

// Configure PDF.js worker for browser
configurePDFWorker('/node_modules/pdfjs-dist/build/pdf.worker.mjs');

// Load airport data once
const airportsDB = await fetch('/data/airports.json').then(r => r.json());
const lookupIATA = iata => airportsDB[iata?.toUpperCase()] ?? null;

// --- DOM references ---
const dropZone    = document.getElementById('drop-zone');
const fileInput   = document.getElementById('pdf-input');
const results     = document.getElementById('results');
const tbody       = document.querySelector('#legs-table tbody');
const parserUsed  = document.getElementById('parser-used');
const log         = document.getElementById('log');
const downloadBtn = document.getElementById('download-ics');

// --- File handling ---
async function handleFile(file) {
  try {
    const buffer = await file.arrayBuffer();
    const text   = await extractTextFromPDF(buffer);
    const { parser, legs } = parse(text, lookupIATA);

    parserUsed.textContent = `Parser: ${parser}`;
    renderLegs(legs);
    results.hidden = false;
  } catch (e) {
    log.textContent = e.message;
  }
}

fileInput.addEventListener('change', e => handleFile(e.target.files[0]));
dropZone.addEventListener('dragover', e => e.preventDefault());
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  handleFile(e.dataTransfer.files[0]);
});

// --- Render editable table rows ---
function renderLegs(legs) {
  tbody.innerHTML = '';
  for (const leg of legs) addRow(leg);
}

function addRow(leg = {}) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input value="${leg.flightNumber ?? ''}"></td>
    <td><input value="${leg.departure?.iata ?? ''}" maxlength="3" style="width:3em;text-transform:uppercase"></td>
    <td><input type="datetime-local" value="${leg.departure?.datetime ?? ''}"></td>
    <td><input value="${leg.arrival?.iata ?? ''}"   maxlength="3" style="width:3em;text-transform:uppercase"></td>
    <td><input type="datetime-local" value="${leg.arrival?.datetime ?? ''}"></td>
    <td><input value="${leg.bookingRef ?? ''}"></td>
    <td><button class="del">✕</button></td>
  `;
  tr.querySelector('.del').onclick = () => tr.remove();
  tbody.appendChild(tr);
}

document.getElementById('add-leg').onclick = () => addRow();

// --- Collect rows and download .ics ---
downloadBtn.onclick = () => {
  const legs = [...tbody.querySelectorAll('tr')].map(tr => {
    const inputs = tr.querySelectorAll('input');
    return {
      flightNumber: inputs[0].value,
      departure:    { iata: inputs[1].value.toUpperCase(), datetime: inputs[2].value },
      arrival:      { iata: inputs[3].value.toUpperCase(), datetime: inputs[4].value },
      bookingRef:   inputs[5].value || null,
      passenger: null, seat: null, class: null, airline: null,
    };
  });

  const ics  = generateICS(legs, lookupIATA);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const a    = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: 'flights.ics',
  });
  a.click();
  URL.revokeObjectURL(a.href);
};
```

---

## Step 9 — CLI (`src/cli.js`)

```js
// src/cli.js
// Usage: bun src/cli.js path/to/itinerary.pdf [--stdout]
// Output: writes <name>.ics next to the PDF, or prints to stdout

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, basename, dirname, join } from 'node:path';
import { configurePDFWorker, extractTextFromPDF } from './extract-pdf.js';
import { lookupIATA }  from './airports.js';
import { parse }       from './parsers/index.js';
import { generateICS } from './ics.js';

configurePDFWorker('');   // disable worker thread in Bun

const args     = process.argv.slice(2);
const pdfPath  = args.find(a => !a.startsWith('--'));
const toStdout = args.includes('--stdout');

if (!pdfPath) {
  console.error('Usage: bun src/cli.js <path-to-pdf> [--stdout]');
  process.exit(1);
}

const buffer          = await readFile(resolve(pdfPath));
const text            = await extractTextFromPDF(buffer.buffer);
const { parser, legs} = parse(text, lookupIATA);

console.error(`Parser: ${parser}, legs found: ${legs.length}`);

if (legs.length === 0) {
  console.error('No legs detected. Exiting.');
  process.exit(1);
}

const ics = generateICS(legs, lookupIATA);

if (toStdout) {
  process.stdout.write(ics);
} else {
  const outPath = join(dirname(resolve(pdfPath)),
                       basename(pdfPath, '.pdf') + '.ics');
  await writeFile(outPath, ics, 'utf8');
  console.error(`Written: ${outPath}`);
}
```

---

## Step 10 — Tests (`tests/extraction.test.js`)

```js
// tests/extraction.test.js
import { describe, test, expect, beforeAll } from 'bun:test';
import { readdir }        from 'node:fs/promises';
import { readFileSync }   from 'node:fs';
import { join }           from 'node:path';
import { configurePDFWorker, extractTextFromPDF } from '../src/extract-pdf.js';
import { lookupIATA, isKnownIATA }  from '../src/airports.js';
import { parse }          from '../src/parsers/index.js';
import { generateICS }    from '../src/ics.js';

beforeAll(() => configurePDFWorker(''));   // no worker in Bun

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

describe('PDF fixtures', () => {
  // Dynamically test every .pdf in tests/fixtures/
  let files = [];
  try {
    files = (await readdir(FIXTURES)).filter(f => f.endsWith('.pdf'));
  } catch { /* fixtures dir missing, skip */ }

  for (const file of files) {
    test(`parses ${file}`, async () => {
      const buf  = readFileSync(join(FIXTURES, file));
      const text = await extractTextFromPDF(buf.buffer);

      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);

      const { parser, legs } = parse(text, lookupIATA);
      console.log(`  [${file}] parser=${parser}, legs=${legs.length}`);

      // Structural assertions on each leg
      for (const leg of legs) {
        expect(leg.departure?.iata).toMatch(/^[A-Z]{3}$/);
        expect(leg.arrival?.iata).toMatch(/^[A-Z]{3}$/);
        expect(leg.departure?.datetime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
        expect(leg.arrival?.datetime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
        expect(isKnownIATA(leg.departure.iata)).toBe(true);
        expect(isKnownIATA(leg.arrival.iata)).toBe(true);
      }

      // ICS generation does not throw
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
```

---

## How to Run

```bash
# 1. Install dependencies
bun install

# 2. (Once) Build airport data
bun run preprocess

# 3. Start dev server and open browser
bun run dev
# → open http://localhost:3000

# 4. Run CLI on a PDF
bun run cli path/to/itinerary.pdf
# → writes path/to/itinerary.ics

# 5. Run tests (put PDFs in tests/fixtures/ first)
bun test
```

---

## Implementation Order

1. `bun install` + `bun run preprocess` → verify `data/airports.json` exists and has expected shape
2. `src/airports.js` → run a quick smoke test: `bun -e "import {lookupIATA} from './src/airports.js'; console.log(lookupIATA('JFK'))"`
3. `src/extract-pdf.js` → verify with `bun -e "..."` on a real PDF
4. `src/parsers/base.js` + `src/parsers/generic.js` → iterate until fixture tests pass
5. `src/ics.js` → validate output with an online ICS validator or import into Google Calendar
6. `src/cli.js` → end-to-end smoke test
7. `server.js` + `web/index.html` + `web/app.js` → browser UI
8. `tests/extraction.test.js` → `bun test`

---

## Known Constraints & Notes

- **Scanned PDFs**: pdfjs-dist extracts selectable text only. Image-only PDFs return empty or garbled text. No OCR is implemented.
- **pdfjs-dist worker path**: after install, always verify `node_modules/pdfjs-dist/build/pdf.worker.mjs` exists. The filename may include `.min.` in some releases.
- **GenericParser accuracy**: heuristic IATA matching will produce false positives for 3-letter English words that happen to be valid airport codes (e.g. "FLY", "SUN"). Filter aggressively using `isKnownIATA()` and proximity to a parsed datetime token.
- **ICS VTIMEZONE block**: omitted intentionally. All major calendar apps accept bare `TZID=` references. Add VTIMEZONE blocks only if a specific calendar app is found to reject the files.
- **Airline-specific parsers**: add new files to `src/parsers/`, implement `canParse()` with a strong signal (e.g. carrier name string, document header, unique field label), register before `GenericParser` in `src/parsers/index.js`.
