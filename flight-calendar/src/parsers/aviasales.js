import { FlightParser } from './base.js';
import { buildPDFTree } from '../extract-pdf-tree.js';

const RUSSIAN_MONTHS = {
  'янв': '01', 'фев': '02', 'мар': '03', 'апр': '04', 'мая': '05', 'май': '05',
  'июн': '06', 'июл': '07', 'авг': '08', 'сен': '09', 'окт': '10', 'ноя': '11', 'дек': '12',
};

class AviasalesParser extends FlightParser {
  get name() { return 'AviasalesParser'; }

  canParse(treeOrText) {
    if (typeof treeOrText === 'string') {
      return this.detectAviasalesFromText(treeOrText);
    }
    return this.detectAviasalesFromTree(treeOrText);
  }

  detectAviasalesFromTree(tree) {
    if (!tree) return false;
    
    for (const page of tree.pages || tree.children) {
      if (page.type !== 'page') continue;
      
      for (const line of (page.children || [])) {
        if (line.type !== 'line') continue;
        
        const textItems = line.children?.filter(c => c.type === 'text' && c.text.trim()) || [];
        const fullText = textItems.map(c => c.text).join(' ');
        
        if (/\b(?:Авиасейлс|Продавец.*билета)/i.test(fullText)) {
          return true;
        }
        
        if (/\bМаршрутная квитанция\b/i.test(fullText)) {
          return true;
        }
      }
    }

    const flightLines = this.findFlightLines(tree);

    if (flightLines.length === 0) return false;

    const aviasalesFlights = flightLines.filter(line => {
      const textItems = line.children?.filter(c => c.type === 'text' && c.text.trim()) || [];
      const fullText = textItems.map(c => c.text).join(' ');
      
      const hasFlightNumber = /\b[A-Z]{2}\s*:\s*\d{1,4}\b/.test(fullText);
      if (!hasFlightNumber) return false;

      return true;
    });

    return aviasalesFlights.length >= 1;
  }

  detectAviasalesFromText(text) {
    const hasAviasalesMarker = /Продавец этого билета[—\s]*Авиасейлс/i.test(text);
    if (hasAviasalesMarker) return true;

    const hasRouteHeader = /(?:Стамбул|Москва|Istanbul|Moscow)[\s—]+(?:Стамбул|Москва|Istanbul|Moscow)/i.test(text);
    const hasFlightNumber = /\bPC\s*:\s*\d{1,4}\b/.test(text);
    
    return hasRouteHeader && hasFlightNumber;
  }

  findFlightLines(tree) {
    const results = [];

    for (const page of tree.pages || tree.children) {
      if (page.type !== 'page') continue;

      for (const line of (page.children || [])) {
        if (line.type === 'line' && 
            this.hasFlightDataPattern(line)) {
          results.push(line);
        }
      }
    }

    return results;
  }

  hasFlightDataPattern(line) {
    const text = line.children
      .filter(c => c.type === 'text' && c.text.trim())
      .map(c => c.text)
      .join(' ');

    const hasIATACode = /\([A-Z]{3}\)/.test(text);
    const hasTime = /\d{1,2}\s*:\s*\d{2}/.test(text);
    const hasFlightNumber = /\b[A-Z]{2}\s*:\s*\d{1,4}\b/.test(text);
    
    return hasIATACode || hasTime || hasFlightNumber;
  }

  parse(treeOrText, airportLookup) {
    if (typeof treeOrText === 'string') {
      return this.parseText(treeOrText, airportLookup);
    }
    
    return this.parseTree(treeOrText, airportLookup);
  }

  parseTree(tree, airportLookup) {
    const flightSections = this.identifyFlightSections(tree, airportLookup);
    const legs = flightSections.map(section => 
      this.extractFlightFromSection(section, airportLookup)
    ).filter(leg => leg !== null);

    return this.deduplicateLegs(legs);
  }

  parseText(text, airportLookup) {
    return this.parseTextAviasales(text, airportLookup);
  }

  parseTextAviasales(text, airportLookup) {
    const legs = [];

    const departureCityMatch = text.match(/(?:Стамбул|Москва|Istanbul|Moscow|L[aA]nd|Paris|Dubai|London|Berlin)[\s—]+(?:Стамбул|Москва|Istanbul|Moscow|L[aA]nd|Paris|Dubai|London|Berlin)/i);
    if (!departureCityMatch) return legs;

    const lines = text.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      const flightNumberMatch = line.match(/\b([A-Z]{2})\s*:\s*(\d{1,4})\b/);
      if (!flightNumberMatch) continue;

      const depTimeMatch = line.match(/\b(\d{1,2})\s*:\s*(\d{2})\b/);
      if (!depTimeMatch) continue;

      const dateMatch = line.match(/\b(\d{1,2})\s+(янв|фев|мар|апр|мая|май|июн|июл|авг|сен|окт|ноя|дек)\s+(\d{4})\b/i);
      if (!dateMatch) continue;

      const departureIATA = this.extractIATA(text);
      const arrivalIATA = this.extractArrivalIATA(text);
      
      if (!departureIATA || !airportLookup(departureIATA)) continue;
      if (!arrivalIATA || !airportLookup(arrivalIATA)) continue;

      const month = RUSSIAN_MONTHS[dateMatch[2].toLowerCase()];
      const day = dateMatch[1].padStart(2, '0');
      const year = dateMatch[3];
      const date = `${year}-${month}-${day}`;

      const depTime = `${depTimeMatch[1].padStart(2, '0')}:${depTimeMatch[2]}`;
      const arrTime = depTime;

      legs.push({
        flightNumber: `${flightNumberMatch[1]} ${flightNumberMatch[2]}`,
        airline: null,
        departure: {
          iata: departureIATA,
          datetime: `${date}T${depTime}`,
          terminal: null,
        },
        arrival: {
          iata: arrivalIATA,
          datetime: `${date}T${arrTime}`,
          terminal: null,
        },
        passenger: null,
        bookingRef: null,
        seat: null,
        class: null,
      });

      break;
    }

    return legs;
  }

  extractIATA(text) {
    const match = text.match(/\(([A-Z]{3})\)/);
    return match ? match[1] : null;
  }

  extractArrivalIATA(text) {
    const matches = text.match(/\(([A-Z]{3})\)/g);
    if (!matches || matches.length < 2) return null;
    
    const secondMatch = matches[1].match(/\(([A-Z]{3})\)/);
    return secondMatch ? secondMatch[1] : null;
  }

  identifyFlightSections(tree, airportLookup) {
    const sections = [];

    for (const page of tree.pages || tree.children) {
      if (page.type !== 'page') continue;

      const lines = page.children ? page.children.filter(c => c.type === 'line') : [];
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (this.isAirportLine(line)) {
          const airportText = line.children
            .filter(c => c.type === 'text' && c.text.trim())
            .map(c => c.text)
            .join(' ');
          
          const iataCodes = this.extractIATACodes(airportText);
          
          const timeLine = this.findTimeLine(lines, i);
          const flightLine = this.findFlightLine(lines, i);
          const dateLine = this.findDateLine(lines, i);
          
          if (timeLine && flightLine && dateLine) {
            sections.push({
              airportLine: { line, index: i, iataCodes },
              timeLine: timeLine,
              flightLine: flightLine,
              dateLine: dateLine,
              pageIndex: page.metadata.pageNumber
            });
          }
        }
      }
    }

    return this.mergeNearbySections(sections);
  }

  mergeNearbySections(sections) {
    if (sections.length === 0) return [];
    
    const merged = [];
    let current = { ...sections[0] };
    
    for (let i = 1; i < sections.length; i++) {
      const next = sections[i];
      
      const sameFlight = 
        current.flightLine?.index === next.flightLine?.index &&
        current.timeLine?.index === next.timeLine?.index &&
        current.dateLine?.index === next.dateLine?.index;
      
      if (sameFlight) {
        const currentIATAs = new Set(current.airportLine.iataCodes || []);
        const nextIATAs = new Set(next.airportLine.iataCodes || []);
        
        current.airportLine.iataCodes = [...new Set([...currentIATAs, ...nextIATAs])];
      } else {
        merged.push(current);
        current = { ...next };
      }
    }
    
    merged.push(current);
    return merged;
  }

  isAirportLine(line) {
    const text = line.children
      .filter(c => c.type === 'text' && c.text.trim())
      .map(c => c.text)
      .join(' ');

    return /\([A-Z]{3}\)/.test(text);
  }

  findTimeLine(lines, airportIndex) {
    for (let i = airportIndex; i >= Math.max(0, airportIndex - 5); i--) {
      const line = lines[i];
      const text = line.children
        .filter(c => c.type === 'text' && c.text.trim())
        .map(c => c.text)
        .join(' ');
      
      if (/\d{1,2}\s*:\s*\d{2}/.test(text) && text.length < 50) {
        return { line, index: i };
      }
    }
    return null;
  }

  findFlightLine(lines, airportIndex) {
    for (let i = Math.max(0, airportIndex - 3); i < airportIndex + 3; i++) {
      const line = lines[i];
      const text = line.children
        .filter(c => c.type === 'text' && c.text.trim())
        .map(c => c.text)
        .join(' ');
      
      if (/\b[A-Z]{2}\s*:\s*\d{1,4}\b/.test(text)) {
        return { line, index: i };
      }
    }
    return null;
  }

  findDateLine(lines, airportIndex) {
    for (let i = airportIndex; i < Math.min(airportIndex + 3, lines.length); i++) {
      const line = lines[i];
      const text = line.children
        .filter(c => c.type === 'text' && c.text.trim())
        .map(c => c.text)
        .join(' ');
      
      if (this.hasRussianDate(text)) {
        return { line, index: i };
      }
    }
    return null;
  }

  hasRussianDate(text) {
    return Object.keys(RUSSIAN_MONTHS).some(month => 
      text.toLowerCase().includes(month)
    ) && /\d{4}/.test(text);
  }

  extractFlightFromSection(section, airportLookup) {
    let flightNumber = null;
    let departureIATA = null;
    let arrivalIATA = null;
    let depTime = null;
    let arrTime = null;
    let depDate = null;
    let arrDate = null;

    if (section.flightLine) {
      const flightText = section.flightLine.line.children
        .filter(c => c.type === 'text' && c.text.trim())
        .map(c => c.text)
        .join(' ');
      
      const flightMatch = flightText.match(/\b([A-Z]{2})\s*:\s*(\d{1,4})\b/);
      if (flightMatch) {
        flightNumber = `${flightMatch[1]} ${flightMatch[2]}`;
      }
    }

    if (section.timeLine) {
      const timeText = section.timeLine.line.children
        .filter(c => c.type === 'text' && c.text.trim())
        .map(c => c.text)
        .join(' ');
      
      const times = timeText.match(/\b(\d{1,2})\s*:\s*(\d{2})\b/g);
      if (times && times.length >= 1) {
        const depTimeMatch = times[0].match(/\b(\d{1,2})\s*:\s*(\d{2})\b/);
        if (depTimeMatch) {
          depTime = `${depTimeMatch[1].padStart(2, '0')}:${depTimeMatch[2]}`;
        }
        
        if (times.length >= 2) {
          const arrTimeMatch = times[1].match(/\b(\d{1,2})\s*:\s*(\d{2})\b/);
          if (arrTimeMatch) {
            arrTime = `${arrTimeMatch[1].padStart(2, '0')}:${arrTimeMatch[2]}`;
          }
        } else {
          arrTime = depTime;
        }
      }
    }

    if (section.airportLine) {
      const airportText = section.airportLine.line.children
        .filter(c => c.type === 'text' && c.text.trim())
        .map(c => c.text)
        .join(' ');
      
      let iataCodes = [...(section.airportLine.iataCodes || this.extractIATACodes(airportText))];
      
      const airportLineIndex = section.airportLine.index;
      
      for (let i = -3; i <= 3; i++) {
        if (i === 0) continue;
        const checkIndex = airportLineIndex + i;
        
        for (const page of (section.airportLine.line.parent?.parent?.pages || [])) {
          if (page.type !== 'page') continue;
          const lines = page.children || [];
          
          if (checkIndex >= 0 && checkIndex < lines.length) {
            const nearbyLine = lines[checkIndex];
            const nearbyText = nearbyLine.children
              .filter(c => c.type === 'text' && c.text.trim())
              .map(c => c.text)
              .join(' ');
            
            const nearbyIATACodes = this.extractIATACodes(nearbyText);
            iataCodes = [...iataCodes, ...nearbyIATACodes];
          }
        }
      }
      
      iataCodes = [...new Set(iataCodes)];
      
      for (const iataCode of iataCodes) {
        if (airportLookup(iataCode)) {
          if (!departureIATA) {
            departureIATA = iataCode;
          } else if (iataCode !== departureIATA && !arrivalIATA) {
            arrivalIATA = iataCode;
            break;
          }
        }
      }
    }

    if (section.dateLine) {
      const dateText = section.dateLine.line.children
        .filter(c => c.type === 'text' && c.text.trim())
        .map(c => c.text)
        .join(' ');
      
      const dates = this.extractDatesFromText(dateText);
      if (dates.length >= 1) {
        depDate = dates[0];
        arrDate = dates.length >= 2 ? dates[1] : depDate;
      }
    }

    if (!flightNumber || !arrivalIATA || !depTime || !depDate) {
      return null;
    }

    const depDatetime = `${depDate}T${depTime}`;
    let arrDatetime = `${arrDate || depDate}T${arrTime || depTime}`;

    if (depTime && arrTime && depDate === arrDate && arrTime < depTime) {
      arrDatetime = this.calculateNextDay(arrDate || depDate) + `T${arrTime}`;
    }

    return {
      flightNumber: flightNumber || 'UNKNOWN',
      airline: null,
      departure: {
        iata: departureIATA || 'UNKNOWN',
        datetime: depDatetime,
        terminal: null,
      },
      arrival: {
        iata: arrivalIATA,
        datetime: arrDatetime,
        terminal: null,
      },
      passenger: null,
      bookingRef: null,
      seat: null,
      class: null,
    };
  }

  extractIATACodes(text) {
    const matches = text.match(/\(([A-Z]{3})\)/g);
    if (!matches) return [];
    
    return matches.map(match => match.match(/\(([A-Z]{3})\)/)[1])
      .filter((code, index, arr) => arr.indexOf(code) === index);
  }

  extractDatesFromText(text) {
    const dates = [];

    for (const [ruMonth, numMonth] of Object.entries(RUSSIAN_MONTHS)) {
      const pattern = new RegExp(`(\\d{1,2})\\s+${ruMonth}\\s+(\\d{4})`, 'ig');
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const day = match[1].padStart(2, '0');
        const year = match[2];
        dates.push(`${year}-${numMonth}-${day}`);
      }
    }

    return [...new Set(dates)].sort();
  }

  calculateNextDay(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  deduplicateLegs(legs) {
    const seen = new Set();
    const unique = [];

    for (const leg of legs) {
      const key = `${leg.flightNumber}-${leg.departure.iata}-${leg.arrival.iata}-${leg.departure.datetime}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(leg);
      }
    }

    return unique.sort((a, b) => {
      const dateA = a.departure.datetime || '';
      const dateB = b.departure.datetime || '';
      return dateA.localeCompare(dateB);
    });
  }
}

export { AviasalesParser };