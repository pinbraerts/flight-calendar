import { FlightParser } from './base.js';

const MONTH_EN = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const MONTH_RU = {
  'янв': 1, 'фев': 2, 'мар': 3, 'апр': 4, 'май': 5, 'мая': 5, 'июн': 6,
  'июл': 7, 'авг': 8, 'сен': 9, 'окт': 10, 'ноя': 11, 'дек': 12,
};

const IATA_RE = /\b([A-Z]{3})\b/g;
const TIME_RE = /\b(\d{2}):(\d{2})\b/g;
const FLIGHT_NO_RE = /\b([A-Z]{2})\s?(\d{1,4})\b/g;

const DATE_PATTERNS = [
  { re: /\b(\d{2})\.(\d{2})\.(\d{4})\b/g, parse: (m) => ({ y: +m[3], mo: +m[2], d: +m[1] }) },
  { re: /\b(\d{4})-(\d{2})-(\d{2})\b/g, parse: (m) => ({ y: +m[1], mo: +m[2], d: +m[3] }) },
  { re: /\b(\d{2})\/(\d{2})\/(\d{4})\b/g, parse: (m) => ({ y: +m[3], mo: +m[2], d: +m[1] }) },
  { re: /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})\b/gi,
    parse: (m) => ({ y: +m[3], mo: MONTH_EN[m[2].toLowerCase().slice(0, 3)], d: +m[1] }) },
  { re: /\b(\d{1,2})\s+(янв|фев|мар|апр|май|мая|июн|июл|авг|сен|окт|ноя|дек)[а-яё]*\s+(\d{4})\b/gi,
    parse: (m) => ({ y: +m[3], mo: MONTH_RU[m[2].toLowerCase().slice(0, 3)] || MONTH_RU[m[2].toLowerCase()], d: +m[1] }) },
];

function pad(n) {
  return String(n).padStart(2, '0');
}

function extractDates(text) {
  const results = [];
  for (const { re, parse } of DATE_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const { y, mo, d } = parse(m);
      results.push({ index: m.index, date: `${y}-${pad(mo)}-${pad(d)}` });
    }
  }
  return results.sort((a, b) => a.index - b.index);
}

function extractTimes(text) {
  const results = [];
  TIME_RE.lastIndex = 0;
  let m;
  while ((m = TIME_RE.exec(text)) !== null) {
    results.push({ index: m.index, time: `${m[1]}:${m[2]}` });
  }
  return results.sort((a, b) => a.index - b.index);
}

function extractIATAs(text, airportLookup) {
  const results = [];
  IATA_RE.lastIndex = 0;
  let m;
  while ((m = IATA_RE.exec(text)) !== null) {
    const code = m[1];
    if (airportLookup(code)) {
      results.push({ index: m.index, code });
    }
  }
  return results.sort((a, b) => a.index - b.index);
}

function extractFlightNumbers(text) {
  const results = [];
  FLIGHT_NO_RE.lastIndex = 0;
  let m;
  while ((m = FLIGHT_NO_RE.exec(text)) !== null) {
    results.push({ index: m.index, flightNumber: `${m[1]} ${m[2]}` });
  }
  return results.sort((a, b) => a.index - b.index);
}

function findNearest(arr, index, maxDist = 200, direction = 'any') {
  let best = null;
  let bestDist = Infinity;
  for (const item of arr) {
    const dist = item.index - index;
    if (direction === 'after' && dist < 0) continue;
    if (direction === 'before' && dist > 0) continue;
    const absDist = Math.abs(dist);
    if (absDist < bestDist && absDist <= maxDist) {
      bestDist = absDist;
      best = item;
    }
  }
  return best;
}

export class GenericParser extends FlightParser {
  get name() { return 'GenericParser'; }

  canParse(text) {
    return true;
  }

  parse(text, airportLookup) {
    const iatas = extractIATAs(text, airportLookup);
    const dates = extractDates(text);
    const times = extractTimes(text);
    const flightNums = extractFlightNumbers(text);

    if (iatas.length < 2) return [];

    const legs = [];
    const usedIatas = new Set();

    for (let i = 0; i < iatas.length - 1; i++) {
      const dep = iatas[i];
      const arr = iatas[i + 1];

      if (usedIatas.has(dep.index) || usedIatas.has(arr.index)) continue;
      if (dep.code === arr.code) continue;

      const depDate = findNearest(dates, dep.index, 500);
      const depTime = findNearest(times, dep.index, 200);
      const arrTime = findNearest(times, arr.index, 200);
      const flightNum = findNearest(flightNums, dep.index, 300);

      if (!depDate || !depTime || !arrTime) continue;
      if (depTime.index === arrTime.index) continue;

      let arrDate = depDate.date;
      if (arrTime.time < depTime.time) {
        const d = new Date(depDate.date);
        d.setDate(d.getDate() + 1);
        arrDate = d.toISOString().slice(0, 10);
      }

      usedIatas.add(dep.index);
      usedIatas.add(arr.index);
      i++;

      legs.push({
        flightNumber: flightNum?.flightNumber ?? 'UNKNOWN',
        airline: null,
        departure: {
          iata: dep.code,
          datetime: `${depDate.date}T${depTime.time}`,
          terminal: null,
        },
        arrival: {
          iata: arr.code,
          datetime: `${arrDate}T${arrTime.time}`,
          terminal: null,
        },
        passenger: null,
        bookingRef: null,
        seat: null,
        class: null,
      });
    }

    return legs;
  }
}
