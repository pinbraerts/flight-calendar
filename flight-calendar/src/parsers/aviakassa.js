import { FlightParser } from './base.js';
import { buildPDFTree } from '../extract-pdf-tree.js';

class AviakassaParser extends FlightParser {
  get name() { return 'AviakassaParser'; }

  canParse(treeOrText) {
    if (typeof treeOrText === 'string') {
      return false;
    }

    return this.detectAviakassaFormat(treeOrText);
  }

  detectAviakassaFormat(tree) {
    for (const page of tree.pages || tree.children) {
      if (page.type !== 'page') continue;

      for (const line of page.children || []) {
        if (line.type !== 'line') continue;

        const text = line.children
          .filter(c => c.type === 'text' && c.text.trim())
          .map(c => c.text)
          .join(' ');

        if (text === 'Aviakassa.com') {
          return true;
        }
      }
    }

    return false;
  }

  parse(treeOrText, airportLookup) {
    if (typeof treeOrText === 'string') {
      throw new Error('AviakassaParser requires PDF tree, not text');
    }

    const flightSections = this.identifyFlightSections(treeOrText, airportLookup);
    const legs = flightSections.map(section => 
      this.extractFlightFromSection(section, airportLookup)
    ).filter(leg => leg !== null);

    return this.deduplicateAndSortLegs(legs);
  }

  identifyFlightSections(tree, airportLookup) {
    const sections = [];

    for (const page of tree.pages || tree.children) {
      if (page.type !== 'page') continue;

      const lines = page.children ? page.children.filter(c => c.type === 'line') : [];
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (this.isRouteHeaderLine(line)) {
          const flightInfo = this.findFlightInfo(lines, i);
          if (flightInfo) {
            const terminalInfo = this.findTerminalInfo(lines, i, flightInfo.cityLine);
            sections.push({
              headerLine: line,
              flightLine: flightInfo.flightLine,
              timeLine: flightInfo.timeLine,
              dateLine: flightInfo.dateLine,
              cityLine: flightInfo.cityLine,
              airlineLine: flightInfo.airlineLine,
              terminalLine: terminalInfo,
              pageIndex: page.metadata.pageNumber
            });
          }
        }
      }
    }

    return sections;
  }

  isRouteHeaderLine(line) {
    if (!line.children || line.children.length === 0) return false;

    const textItems = line.children.filter(c => c.type === 'text' && c.text.trim());
    const fullText = textItems.map(c => c.text).join(' ');

    return /\s+→\s+/.test(fullText);
  }

  findFlightInfo(lines, headerIndex) {
    const headerY = lines[headerIndex].bbox.y;

    let flightLine = null;
    let timeLine = null;
    let dateLine = null;
    let cityLine = null;
    let airlineLine = null;

    for (let i = headerIndex + 1; i < Math.min(headerIndex + 30, lines.length); i++) {
      const line = lines[i];
      const yDiff = Math.abs(line.bbox.y - headerY);

      if (yDiff > 150) break;

      if (!flightLine && this.hasFlightNumberLine(line)) {
        flightLine = line;
      }

      if (!timeLine && this.hasTimeLine(line) && !this.hasFlightNumberLine(line)) {
        timeLine = line;
      }

      if (!dateLine && this.hasDateLine(line)) {
        dateLine = line;
      }

      if (!cityLine && this.hasCityLine(line)) {
        cityLine = line;
      }

      if (!airlineLine && this.hasAirlineLine(line)) {
        airlineLine = line;
      }
    }

    if (flightLine && dateLine && cityLine) {
      return { flightLine, timeLine, dateLine, cityLine, airlineLine };
    }

    return null;
  }

  findTerminalInfo(lines, headerIndex, cityLine) {
    if (!cityLine) return null;

    const cityY = cityLine.bbox.y;
    const cityIndex = lines.indexOf(cityLine);

    for (let i = Math.max(0, cityIndex - 5); i < Math.min(lines.length, cityIndex + 5); i++) {
      const line = lines[i];
      const yDiff = Math.abs(line.bbox.y - cityY);

      if (yDiff < 2) continue;
      if (yDiff > 30) continue;

      if (this.hasTerminalLine(line)) {
        return line;
      }
    }

    return null;
  }

  hasFlightNumberLine(line) {
    const text = line.children
      .filter(c => c.type === 'text' && c.text.trim())
      .map(c => c.text)
      .join(' ');

    return /\b[A-Z]{2}-\d{1,4}\b/.test(text);
  }

  hasTimeLine(line) {
    const text = line.children
      .filter(c => c.type === 'text' && c.text.trim())
      .map(c => c.text)
      .join(' ');

    const times = text.match(/\d{2}:\d{2}\b/g);
    return times && times.length >= 2;
  }

  hasDateLine(line) {
    const text = line.children
      .filter(c => c.type === 'text' && c.text.trim())
      .map(c => c.text)
      .join(' ');

    return /\b\d{2}\.\d{2}\.\d{4}\b/.test(text);
  }

  hasCityLine(line) {
    if (!line.children || line.children.length === 0) return false;

    const text = line.children
      .filter(c => c.type === 'text' && c.text.trim())
      .map(c => c.text)
      .join(' ');

    const hasRussianText = /[а-яА-Я]/.test(text);
    if (hasRussianText) {
      return false;
    }

    const hasAirportKeywords = /\bterminal\b|\bAirport\b|\bInternational\b/i.test(text);
    if (hasAirportKeywords) {
      return false;
    }

    const words = text.split(/\s+/);
    const cityWords = words.filter(w => /^[A-Z][a-z]+$/.test(w));

    return cityWords.length === 2;
  }

  hasAirlineLine(line) {
    if (!line.children || line.children.length === 0) return false;

    const textItems = line.children.filter(c => c.type === 'text' && c.text.trim());
    
    if (textItems.length !== 1) return false;

    const text = textItems[0].text.trim();

    return /^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(text);
  }

  hasTerminalLine(line) {
    if (!line.children || line.children.length === 0) return false;

    const text = line.children
      .filter(c => c.type === 'text' && c.text.trim())
      .map(c => c.text)
      .join(' ');

    return /\bterminal\b/i.test(text) || /\bAirport\b/i.test(text) || /\bInternational\b/i.test(text);
  }

  extractFlightFromSection(section, airportLookup) {
    let flightNumber = null;
    let departureTime = null;
    let arrivalTime = null;
    let depDate = null;
    let arrDate = null;
    let departureCity = null;
    let arrivalCity = null;
    let airlineName = null;
    let departureIATA = null;
    let arrivalIATA = null;

    if (section.flightLine) {
      const flightText = section.flightLine.children
        .filter(c => c.type === 'text' && c.text.trim())
        .map(c => c.text)
        .join(' ');

      const flightMatch = flightText.match(/\b([A-Z]{2})-(\d{1,4})\b/);
      if (flightMatch) {
        flightNumber = `${flightMatch[1]} ${flightMatch[2]}`;
      }
    }

    let timesToProcess = section.timeLine;

    if (!timesToProcess && section.flightLine) {
      const flightText = section.flightLine.children
        .filter(c => c.type === 'text' && c.text.trim())
        .map(c => c.text)
        .join(' ');

      const times = flightText.match(/\b\d{2}:\d{2}\b/g);
      if (times && times.length >= 2) {
        departureTime = times[0];
        arrivalTime = times[1];
      }
    }

    if (timesToProcess && (!departureTime || !arrivalTime)) {
      const timeText = timesToProcess.children
        .filter(c => c.type === 'text' && c.text.trim())
        .map(c => c.text);

      const times = [];
      for (const text of timeText) {
        const timeMatch = text.match(/\b(\d{2}:\d{2})\b/);
        if (timeMatch) {
          times.push(timeMatch[1]);
        }
      }

      if (times.length >= 2) {
        departureTime = times[0];
        arrivalTime = times[1];
      }
    }

    if (section.dateLine) {
      const dateText = section.dateLine.children
        .filter(c => c.type === 'text' && c.text.trim())
        .map(c => c.text);

      const dates = [];
      for (const text of dateText) {
        const dateMatch = text.match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/);
        if (dateMatch) {
          dates.push(`${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`);
        }
      }

      if (dates.length >= 1) {
        depDate = dates[0];
        arrDate = dates.length >= 2 ? dates[1] : dates[0];
      }
    }

    const allAirports = this.getAllAirports(airportLookup);

    if (section.terminalLine) {
      const terminalText = section.terminalLine.children
        .filter(c => c.type === 'text' && c.text.trim())
        .map(c => c.text)
        .join(' ');

      const iataCodes = this.extractIATAFromTerminal(terminalText, allAirports);
      if (iataCodes.departure) {
        departureIATA = iataCodes.departure;
      }
      if (iataCodes.arrival) {
        arrivalIATA = iataCodes.arrival;
      }
    }

    if (section.headerLine) {
      const headerText = section.headerLine.children
        .filter(c => c.type === 'text' && c.text.trim())
        .map(c => c.text)
        .join(' ');

      const cityMatch = headerText.match(/([A-Z][a-z]+)\s+→\s+([A-Z][a-z]+)/);
      if (cityMatch) {
        const headerDepCity = cityMatch[1];
        const headerArrCity = cityMatch[2];

        const headerDepIATA = this.findIATAByCity(headerDepCity, airportLookup);
        const headerArrIATAs = this.findAllIATAsByCity(headerArrCity, airportLookup);

        if (departureIATA && !arrivalIATA && headerArrIATAs.length > 0) {
          if (headerArrIATAs.includes(departureIATA)) {
            arrivalIATA = departureIATA;
            if (headerDepIATA) {
              departureIATA = headerDepIATA;
            }
          } else if (headerArrIATAs.includes(headerDepIATA)) {
            arrivalIATA = headerDepIATA;
          }
        }

        if (!departureIATA && headerDepIATA) {
          departureIATA = headerDepIATA;
        }

        if (!arrivalIATA && headerArrIATAs.length > 0) {
          arrivalIATA = headerArrIATAs[0];
        }
      }
    }

    if (section.airlineLine) {
      const airlineText = section.airlineLine.children
        .filter(c => c.type === 'text' && c.text.trim())
        .map(c => c.text)
        .join(' ');

      const airlineMatch = airlineText.match(/([A-Z][a-z]+\s+[A-Z][a-z]+)/);
      if (airlineMatch) {
        airlineName = airlineMatch[1];
      }
    }

    if (!flightNumber || !departureTime || !arrivalTime || !depDate) {
      return null;
    }

    if (!departureIATA || !arrivalIATA) {
      return null;
    }

    const depDatetime = `${depDate}T${departureTime}`;
    let arrDatetime = `${arrDate}T${arrivalTime}`;

    if (depDate === arrDate && arrivalTime < departureTime) {
      arrDatetime = this.calculateNextDay(arrDate) + `T${arrivalTime}`;
    }

    return {
      flightNumber,
      airline: airlineName,
      departure: {
        iata: departureIATA,
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

  getAllAirports(airportLookup) {
    const airports = {};
    for (let iata = 'AAA'; iata <= 'ZZZ'; iata = this.nextIATA(iata)) {
      const airport = airportLookup(iata);
      if (airport) {
        airports[iata] = airport;
      }
    }
    return airports;
  }

  extractIATAFromTerminal(terminalText, allAirports) {
    const iataCodes = { departure: null, arrival: null };

    const words = terminalText.split(/[\s,]+/);
    const potentialIATAs = words.filter(w => /^[A-Z]{3}$/.test(w));

    for (const iata of potentialIATAs) {
      if (allAirports[iata]) {
        if (!iataCodes.departure) {
          iataCodes.departure = iata;
        } else if (!iataCodes.arrival && iata !== iataCodes.departure) {
          iataCodes.arrival = iata;
          return iataCodes;
        }
      }
    }

    const significantWords = words.filter(w => w.length >= 4 && /^[A-Z]/.test(w) && !['International', 'terminal', 'Airport'].includes(w));

    for (const word of significantWords) {
      const wordLower = word.toLowerCase();
      let bestMatch = null;
      let bestScore = 0;

      for (const [iata, airport] of Object.entries(allAirports)) {
        if (airport.name) {
          const nameLower = airport.name.toLowerCase();
          const nameParts = nameLower.split(' ');
          
          if (nameParts[0] === wordLower) {
            bestMatch = { iata, score: 100 };
            break;
          }
        }
        
        if (airport.city && airport.city.toLowerCase() === wordLower) {
          if (!bestMatch || bestMatch.score < 50) {
            bestMatch = { iata, score: 50 };
          }
        }
      }

      if (bestMatch) {
        if (!iataCodes.departure) {
          iataCodes.departure = bestMatch.iata;
        } else if (!iataCodes.arrival && bestMatch.iata !== iataCodes.departure) {
          iataCodes.arrival = bestMatch.iata;
          break;
        }
      }
    }

    return iataCodes;
  }

  findIATAByCity(cityName, airportLookup) {
    const iatas = this.findAllIATAsByCity(cityName, airportLookup);
    return iatas.length > 0 ? iatas[0] : null;
  }

  findAllIATAsByCity(cityName, airportLookup) {
    if (!cityName) return [];

    const cityLower = cityName.toLowerCase();
    const candidates = [];

    for (let iata = 'AAA'; iata <= 'ZZZ'; iata = this.nextIATA(iata)) {
      const airport = airportLookup(iata);
      if (!airport) continue;

      if (airport.city && airport.city.toLowerCase() === cityLower) {
        candidates.push({ iata, score: 100 });
      } else if (airport.name && airport.name.toLowerCase().includes(cityLower)) {
        candidates.push({ iata, score: 50 });
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    return candidates.map(c => c.iata);
  }

  nextIATA(iata) {
    const chars = iata.split('');
    for (let i = 2; i >= 0; i--) {
      if (chars[i] < 'Z') {
        chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
        for (let j = i + 1; j < 3; j++) {
          chars[j] = 'A';
        }
        return chars.join('');
      }
    }
    return null;
  }

  calculateNextDay(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  deduplicateAndSortLegs(legs) {
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

export { AviakassaParser };
