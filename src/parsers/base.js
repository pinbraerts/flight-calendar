/**
 * @typedef {{
 *   iata:     string,
 *   datetime: string,
 *   terminal: string|null,
 * }} FlightEndpoint
 *
 * @typedef {{
 *   flightNumber: string,
 *   airline:      string|null,
 *   departure:    FlightEndpoint,
 *   arrival:      FlightEndpoint,
 *   passenger:    string|null,
 *   bookingRef:   string|null,
 *   seat:         string|null,
 *   class:        string|null,
 * }} FlightLeg
 */

export class FlightParser {
  /** Human-readable name shown in debug output */
  get name() { return 'BaseParser'; }

  /**
   * Return true if this parser recognises the extracted text.
   * Called in order on all registered parsers; first match wins.
   * @param {string} text
   * @returns {boolean}
   */
  canParse(text) { return false; }

  /**
   * Parse text into flight legs. Only called when canParse() returned true.
   * @param {string} text
   * @param {(iata: string) => object|null} airportLookup
   * @returns {FlightLeg[]}
   */
  parse(text, airportLookup) { return []; }
}
