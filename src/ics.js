const CRLF = '\r\n';

/** Fold a single content line to max 75 octets per RFC 5545 §3.1 */
function foldLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const chars = [...line];
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
 * @param {import('./parsers/base.js').FlightLeg[]} legs
 * @param {(iata: string) => object|null} airportLookup
 * @returns {string}  Complete .ics file content
 */
export function generateICS(legs, airportLookup) {
  if (!airportLookup || typeof airportLookup !== 'function') {
    console.error('generateICS: airportLookup is not a function:', typeof airportLookup);
    return '';
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FlightCalendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  console.log(`generateICS: Processing ${legs.length} legs`);

  for (const leg of legs) {
    const dep = airportLookup(leg.departure.iata);
    const arr = airportLookup(leg.arrival.iata);

    console.log(`generateICS: Leg ${leg.flightNumber} ${leg.departure.iata} -> ${leg.arrival.iata}:`, 
                `dep=${dep ? 'found' : 'NOT FOUND'}, arr=${arr ? 'found' : 'NOT FOUND'}`);

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
      `SUMMARY:${foldLine(summary)}`,
      `DTSTART;TZID=${dep.tz}:${depDT}`,
      `DTEND;TZID=${arr.tz}:${arrDT}`,
      `LOCATION:${foldLine(location)}`,
      `GEO:${geoStr}`,
      `DESCRIPTION:${descParts}`,
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');

  return lines.map(foldLine).join(CRLF) + CRLF;
}
