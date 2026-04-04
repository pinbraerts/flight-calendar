import { FlightParser } from './base.js';

const RUSSIAN_MONTHS = {
  'января': '01', 'февраля': '02', 'марта': '03', 'апреля': '04', 'мая': '05',
  'июня': '06', 'июля': '07', 'августа': '08', 'сентября': '09', 'октября': '10',
  'ноября': '11', 'декабря': '12',
};

class AlfastrakhItineraryParser extends FlightParser {
  get name() { return 'AlfastrakhItineraryParser'; }

  canParse(treeOrText) {
    if (typeof treeOrText === 'string') {
      return this.detectFromText(treeOrText);
    }
    return this.detectFromTree(treeOrText);
  }

  detectFromText(text) {
    if (!text || typeof text !== 'string') return false;

    const hasHeader = /^ЭЛЕКТРОННЫЙ БИЛЕТ\s*МАРШРУТНАЯ КВИТАНЦИЯ/m.test(text);
    const hasAlfastrakh = /В Альфа-Тревел/i.test(text);
    const hasFlightData = /^[A-Z]{2} \d{3,4}$/m.test(text);

    return hasHeader && hasAlfastrakh && hasFlightData;
  }

  detectFromTree(tree) {
    if (!tree) return false;

    const text = this.extractTextFromTree(tree);
    
    const hasHeader = /^ЭЛЕКТРОННЫЙ БИЛЕТ\s*МАРШРУТНАЯ КВИТАНЦИЯ/m.test(text);
    const hasAlfastrakh = /В Альфа-Тревел/i.test(text);
    const hasFlightData = /[A-Z]{2}\s+\d{3,4}/.test(text);

    return hasHeader && hasAlfastrakh && hasFlightData;
  }

  extractTextFromTree(tree) {
    if (!tree) return '';
    
    const textItems = [];
    
    for (const page of tree.pages || tree.children) {
      if (page.type !== 'page') continue;
      
      for (const line of (page.children || [])) {
        if (line.type !== 'line') continue;
        
        const lineText = line.children
          ?.filter(c => c.type === 'text' && c.text?.trim())
          ?.map(c => c.text)
          ?.join(' ')
          ?.trim() || '';
        
        if (lineText) {
          textItems.push(lineText);
        }
      }
    }
    
    return textItems.join('\n');
  }

  parse(treeOrText, airportLookup) {
    if (typeof treeOrText === 'string') {
      return this.parseText(treeOrText, airportLookup);
    }
    
    const text = this.extractTextFromTree(treeOrText);
    return this.parseText(text, airportLookup);
  }

  parseText(text, airportLookup) {
    const lines = text.split('\n');
    const legs = [];

    let bookingRef = null;
    let passenger = null;
    let airline = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const bookingMatch = trimmed.match(/^[A-Z0-9]{6}$/);
      if (bookingMatch && !bookingRef && !trimmed.includes('Код агентства') && !trimmed.includes('AA')) {
        bookingRef = trimmed;
        continue;
      }

      const multiBookingMatch = trimmed.match(/^([A-Z0-9]{6})\s+/);
      if (multiBookingMatch && !bookingRef) {
        bookingRef = multiBookingMatch[1];
        continue;
      }

      if (trimmed.includes('Turkish Airlines')) {
        airline = 'Turkish Airlines';
        continue;
      }

      if (trimmed.includes('Аэрофлот')) {
        airline = 'Аэрофлот';
        continue;
      }
    }

    const passengerLineIndex = lines.findIndex(l => l.includes('Фамилия Имя'));
    if (passengerLineIndex >= 0 && passengerLineIndex + 1 < lines.length) {
      const passengerLine = lines[passengerLineIndex + 1].trim();
      const passengerMatch = passengerLine.match(/^([A-Z]+\s+[A-Z]+)/);
      if (passengerMatch) {
        passenger = passengerMatch[1].trim();
      } else {
        passenger = passengerLine.split(/\s+/).slice(0, 2).join(' ');
      }
    }

    const flightSections = this.extractFlightSectionsFromText(text);
    
    for (const section of flightSections) {
      const leg = this.parseTextFlightSection(section, bookingRef, passenger, airline, airportLookup);
      if (leg) {
        legs.push(leg);
      }
    }

    return legs;
  }

  extractFlightSectionsFromText(text) {
    const sections = [];
    const lines = text.split('\n');
    
    let currentSection = [];
    let inFlightSection = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (/^[A-Z]{2}\s+\d{3,4}\b/.test(line) && !/\d{10}/.test(line)) {
        if (currentSection.length > 0 && inFlightSection) {
          sections.push(currentSection.join('\n'));
        }
        currentSection = [line];
        inFlightSection = true;
      } else if (inFlightSection) {
        if (line.includes('Примечания:') || line.includes('Стоимость билета') ||
            line.includes('Обмен и возврат') || line.includes('Контакт-центр') ||
            line.includes('Публичная оферта') || line.includes('Рейс') ||
            line.includes('Данные полета')) {
          if (currentSection.length > 0) {
            sections.push(currentSection.join('\n'));
          }
          currentSection = [];
          inFlightSection = false;
        } else {
          currentSection.push(line);
        }
      }
    }
    
    if (currentSection.length > 0) {
      sections.push(currentSection.join('\n'));
    }
    
    return sections;
  }

  parseTextFlightSection(section, bookingRef, passenger, airline, airportLookup) {
    const lines = section.split('\n');
    const flightInfo = {
      airlineCode: null,
      flightNumber: null,
      departureAirport: null,
      arrivalAirport: null,
      departureTime: null,
      arrivalTime: null,
      departureDate: null,
      arrivalDate: null,
      class: null,
      departureTerminal: null,
      arrivalTerminal: null,
    };

    let seenStatusAfterFirstTime = false;
    let seenFirstTime = false;

    for (const line of lines) {
      const flightMatch = line.match(/(?:^|[\s,])([A-Z]{2})\s+(\d{3,4})(?:$|\s|,)/);
      if (flightMatch) {
        flightInfo.airlineCode = flightMatch[1];
        flightInfo.flightNumber = flightMatch[2];
        continue;
      }

      if (line.includes('Статус') && seenFirstTime) {
        seenStatusAfterFirstTime = true;
      }

      const airportMatch = line.match(/\(([A-Z]{3})\)/g);
      const terminalMatch = line.match(/Терминал\s+([A-Z0-9])/i);
      
      if (airportMatch) {
        for (const m of airportMatch) {
          const airport = m.replace(/[()]/g, '');
          let terminal = null;
          if (terminalMatch) {
            terminal = terminalMatch[1];
          }
          
          if (!flightInfo.departureAirport) {
            flightInfo.departureAirport = airport;
            if (terminal) {
              flightInfo.departureTerminal = terminal;
            }
          } else if (!flightInfo.arrivalAirport && airport !== flightInfo.departureAirport) {
            flightInfo.arrivalAirport = airport;
            if (terminal) {
              flightInfo.arrivalTerminal = terminal;
            }
          }
        }
      } else if (terminalMatch) {
        if (!seenStatusAfterFirstTime) {
          if (!flightInfo.departureTerminal) {
            flightInfo.departureTerminal = terminalMatch[1];
          } else {
            flightInfo.arrivalTerminal = terminalMatch[1];
          }
        } else {
          if (!flightInfo.arrivalTerminal) {
            flightInfo.arrivalTerminal = terminalMatch[1];
          } else {
            flightInfo.departureTerminal = terminalMatch[1];
          }
        }
      }

      const timeLineMatch = line.match(/(\d{1,2}):(\d{2})\s+(\d{1,2})\s+([А-Яа-яA-Za-z]+)\s+(\d{4})\s+\d{1,2}:\d{2}\s+(\d{1,2}):(\d{2})\s+(\d{1,2})\s+([А-Яа-яA-Za-z]+)\s+(\d{4})/);
      
      if (timeLineMatch) {
        flightInfo.arrivalTime = `${timeLineMatch[1].padStart(2, '0')}:${timeLineMatch[2].padStart(2, '0')}`;
        const arrivalMonth = timeLineMatch[4];
        const arrivalMonthNum = RUSSIAN_MONTHS[arrivalMonth] || RUSSIAN_MONTHS[arrivalMonth.toLowerCase()] || '02';
        flightInfo.arrivalDate = `${timeLineMatch[5]}-${arrivalMonthNum}-${timeLineMatch[3].padStart(2, '0')}`;

        flightInfo.departureTime = `${timeLineMatch[6].padStart(2, '0')}:${timeLineMatch[7].padStart(2, '0')}`;
        const departureMonth = timeLineMatch[9];
        const departureMonthNum = RUSSIAN_MONTHS[departureMonth] || RUSSIAN_MONTHS[departureMonth.toLowerCase()] || '02';
        flightInfo.departureDate = `${timeLineMatch[10]}-${departureMonthNum}-${timeLineMatch[8].padStart(2, '0')}`;
        continue;
      }

      const timeMatch = line.match(/(?:^|[^\d:])(\d{1,2}):(\d{2})\s+(\d{1,2})\s+([А-Яа-яA-Za-z]+)\s+(\d{4})(?:$|[^\d:])/);
      
      if (timeMatch) {
        const time = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2].padStart(2, '0')}`;
        const day = timeMatch[3].padStart(2, '0');
        const month = timeMatch[4];
        const monthLowerCase = month.toLowerCase();
        const monthNum = RUSSIAN_MONTHS[month] || (monthLowerCase in RUSSIAN_MONTHS ? RUSSIAN_MONTHS[monthLowerCase] : '01');
        const year = timeMatch[5];
        const date = `${year}-${monthNum}-${day}`;

        if (!seenFirstTime) {
          flightInfo.departureTime = time;
          flightInfo.departureDate = date;
          seenFirstTime = true;
        } else if (!seenStatusAfterFirstTime) {
          flightInfo.arrivalTime = time;
          flightInfo.arrivalDate = date;
        } else {
          flightInfo.arrivalTime = flightInfo.departureTime;
          flightInfo.arrivalDate = flightInfo.departureDate;
          flightInfo.departureTime = time;
          flightInfo.departureDate = date;
        }
        continue;
      }

      if (line.includes('Эконом')) {
        const classMatch = line.match(/Эконом\s+([A-Z])/);
        if (classMatch) {
          flightInfo.class = classMatch[1];
        }
      } else if (line.includes('возврат')) {
        const classMatch = line.match(/возврат\s+([A-Z])/);
        if (classMatch) {
          flightInfo.class = classMatch[1];
        }
      }
    }

    if (!flightInfo.departureAirport || !flightInfo.arrivalAirport) {
      return null;
    }

    const departureAirportInfo = airportLookup(flightInfo.departureAirport);
    const arrivalAirportInfo = airportLookup(flightInfo.arrivalAirport);

    if (!departureAirportInfo || !arrivalAirportInfo) {
      return null;
    }

    return {
      flightNumber: flightInfo.airlineCode && flightInfo.flightNumber 
        ? `${flightInfo.airlineCode} ${flightInfo.flightNumber}` 
        : null,
      airline: airline || null,
      departure: {
        iata: flightInfo.departureAirport,
        datetime: flightInfo.departureDate && flightInfo.departureTime 
          ? `${flightInfo.departureDate}T${flightInfo.departureTime}` 
          : null,
        terminal: flightInfo.departureTerminal || null,
      },
      arrival: {
        iata: flightInfo.arrivalAirport,
        datetime: flightInfo.arrivalDate && flightInfo.arrivalTime 
          ? `${flightInfo.arrivalDate}T${flightInfo.arrivalTime}` 
          : null,
        terminal: flightInfo.arrivalTerminal || null,
      },
      passenger: passenger || null,
      bookingRef: bookingRef || null,
      seat: null,
      class: flightInfo.class || null,
    };
  }
}

export { AlfastrakhItineraryParser };
