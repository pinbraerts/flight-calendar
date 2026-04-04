import { FlightParser } from './base.js';
import { buildPDFTree } from '../extract-pdf-tree.js';

const RUSSIAN_MONTHS = {
  'янв': '01', 'фев': '02', 'мар': '03', 'апр': '04', 'мая': '05', 'май': '05',
  'июн': '06', 'июл': '07', 'авг': '08', 'сен': '09', 'окт': '10', 'ноя': '11', 'дек': '12',
  'авг': '08'
};

class AlfastrakhParser extends FlightParser {
  get name() { return 'AlfastrakhParser'; }

  canParse(treeOrText) {
    if (typeof treeOrText === 'string') {
      return false;
    }

    return this.detectAlfastrakhFormat(treeOrText);
  }

  detectAlfastrakhFormat(tree) {
    const flightLines = this.findFlightLines(tree);

    if (flightLines.length === 0) return false;

    const alfastrakhFlights = flightLines.filter(line => {
      const textItems = line.children?.filter(c => c.type === 'text' && c.text.trim()) || [];
      const fullText = textItems.map(c => c.text).join(' ');
      
      const hasFlightNumber = /\b[A-Z]{2}-\d{1,4}(?:\s|$)/.test(fullText);
      if (!hasFlightNumber) return false;

      const fontSize = textItems[0]?.metadata.fontSize;
      const hasCorrectFontSize = fontSize >= 13 && fontSize <= 14;
      
      return hasCorrectFontSize;
    });

    return alfastrakhFlights.length >= 1;
  }

  findFlightLines(tree) {
    const results = [];

    for (const page of tree.pages || tree.children) {
      if (page.type !== 'page') continue;

      for (const line of (page.children || [])) {
        if (line.type === 'line' && 
            this.hasFlightNumberPattern(line) &&
            this.hasConsistentFlightFont(line)) {
          results.push(line);
        }
      }
    }

    return results;
  }

  hasFlightNumberPattern(line) {
    const text = line.children
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join(' ');

    return /\b[A-Z]{2}-\d{1,4}(?:\s|$)/.test(text);
  }

  hasConsistentFlightFont(line) {
    const fonts = line.children
      .filter(c => c.type === 'text' && c.text.trim())
      .map(c => c.metadata.fontFamily);

    return fonts.length > 0 && fonts.every(f => f === fonts[0]);
  }

  parse(treeOrText, airportLookup) {
    let tree = treeOrText;
    
    if (typeof treeOrText === 'string') {
      throw new Error('TreeBasedParser requires PDF tree, not text');
    }

    const flightSections = this.identifyFlightSections(tree, airportLookup);
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
        
        if (this.isFlightDataRow(line)) {
          const header = this.findTableHeader(lines, i);
          if (header) {
            const dateRow = this.findDateRow(lines, i);
            sections.push({
              flightRow: line,
              headerRow: header,
              dateRow: dateRow,
              pageIndex: page.metadata.pageNumber
            });
          }
        }
      }
    }

    return sections;
  }

  isFlightDataRow(line) {
    if (!line.children || line.children.length === 0) return false;

    const textItems = line.children.filter(c => c.type === 'text' && c.text.trim());
    
    if (textItems.length < 3) return false;

    const fullText = textItems.map(c => c.text).join(' ');
    
    const hasFlightNumber = /\b[A-Z]{2}-\d{1,4}(?:\s|$)/.test(fullText);
    if (!hasFlightNumber) return false;

    const fontSize = textItems[0].metadata.fontSize;
    const hasConsistentFontSize = textItems.every(t => 
      Math.abs(t.metadata.fontSize - fontSize) < 0.1
    );
    
    if (!hasConsistentFontSize) return false;

    const expectedItemPattern = textItems.length >= 3 && textItems.length <= 6;
    
    return expectedItemPattern;
  }

  findTableHeader(lines, flightRowIndex) {
    const flightRow = lines[flightRowIndex];
    const flightY = flightRow.bbox.y;

    for (let i = flightRowIndex - 1; i >= Math.max(0, flightRowIndex - 30); i--) {
      const line = lines[i];
      const yDiff = Math.abs(line.bbox.y - flightY);

      if (yDiff > 50) break;

      if (this.isTableHeaderLine(line)) {
        return { line, index: i };
      }
    }

    return null;
  }

  isTableHeaderLine(line) {
    if (!line.children || line.children.length === 0) return false;

    const textItems = line.children.filter(c => c.type === 'text' && c.text.trim());
    const fullText = textItems.map(c => c.text).join(' ');

    const hasRequiredColumns = 
      fullText.includes('Рейс') && 
      fullText.includes('Вылет') && 
      fullText.includes('Прилёт');

    if (!hasRequiredColumns) return false;

    const fontSet = new Set(textItems.map(t => t.metadata.fontFamily));
    
    return fontSet.size >= 2 && fontSet.size <= 3;
  }

  findDateRow(lines, flightRowIndex) {
    const flightRow = lines[flightRowIndex];
    const flightY = flightRow.bbox.y;

    for (let i = flightRowIndex + 1; i < Math.min(flightRowIndex + 20, lines.length); i++) {
      const line = lines[i];
      const yDiff = Math.abs(flightY - line.bbox.y);

      if (yDiff < 10) continue;
      if (yDiff > 30) break;

      if (this.isDateRow(line)) {
        return { line, index: i };
      }
    }

    return null;
  }

  isDateRow(line) {
    if (!line.children || line.children.length === 0) return false;

    const textItems = line.children.filter(c => c.type === 'text' && c.text.trim());
    const fullText = textItems.map(c => c.text).join(' ');

    const hasRussianMonth = Object.keys(RUSSIAN_MONTHS).some(month => 
      fullText.toLowerCase().includes(month)
    );

    if (!hasRussianMonth) return false;

    const hasYear = /\b20[0-9]{2}\b/.test(fullText);
    
    return hasYear;
  }

  extractFlightFromSection(section, airportLookup) {
    const textItems = section.flightRow.children.filter(c => c.type === 'text' && c.text.trim());

    if (textItems.length < 3) return null;

    let flightNumber = null;
    let departureIATA = null;
    let arrivalIATA = null;
    let depTime = null;
    let arrTime = null;

    for (const item of textItems) {
      const text = item.text.trim();

      const flightMatch = text.match(/^([A-Z]{2})-(\d{1,4})$/);
      if (flightMatch) {
        flightNumber = `${flightMatch[1]} ${flightMatch[2]}`;
        continue;
      }

      const iataTimeMatch = text.match(/^([A-Z]{3})\s+(\d{2}:\d{2})$/);
      if (iataTimeMatch) {
        const iataCode = iataTimeMatch[1];
        const time = iataTimeMatch[2];

        if (airportLookup(iataCode)) {
          if (!departureIATA) {
            departureIATA = iataCode;
            depTime = time;
          } else if (arrivalIATA !== iataCode) {
            arrivalIATA = iataCode;
            arrTime = time;
          }
        }
      }
    }

    if (!flightNumber || !departureIATA || !arrivalIATA) {
      return null;
    }

    let depDate = null;
    let arrDate = null;

    if (section.dateRow) {
      const dateText = section.dateRow.line.children
        .filter(c => c.type === 'text' && c.text.trim())
        .map(c => c.text)
        .join(' ');

      const dates = this.extractDatesFromText(dateText);
      if (dates.length >= 1) {
        depDate = dates[0];
        arrDate = dates.length >= 2 ? dates[1] : depDate;
      }
    }

    if (!depDate) {
      return null;
    }

    const depDatetime = `${depDate}T${depTime}`;
    let arrDatetime = `${arrDate}T${arrTime}`;

    if (depTime && arrTime && depDate === arrDate && arrTime < depTime) {
      arrDatetime = this.calculateNextDay(arrDate) + `T${arrTime}`;
    }

    return {
      flightNumber: flightNumber || 'UNKNOWN',
      airline: null,
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

  extractDatesFromText(text) {
    const dates = [];
    const yearMatch = text.match(/\b(20[0-9]{2})\b/);
    const year = yearMatch ? yearMatch[1] : '2025';

    for (const [ruMonth, numMonth] of Object.entries(RUSSIAN_MONTHS)) {
      const pattern = new RegExp(`(\\d{1,2})\\s+${ruMonth}\\s*\\/\\s*\\w+?\\s+${year}`, 'ig');
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const day = match[1].padStart(2, '0');
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

export { AlfastrakhParser };