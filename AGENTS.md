# Agent Rules

## ⛔ CRITICAL FORBIDDEN PATTERNS (READ FIRST)

**STOP IMMEDIATELY if you're about to do any of these:**

### ❌ FORBIDDEN - Hardcoded airport/city/airline names
```javascript
// ❌ WRONG - NEVER DO THIS
if (text.includes('Moscow')) return 'SVO';  // FORBIDDEN
if (text.includes('JAT Airways')) ...       // FORBIDDEN
const knownAirlines = ['Aeroflot', 'S7'];  // FORBIDDEN
```

```javascript
// ✅ CORRECT - Use data/airports.json
const airport = airportLookup(iata);        // REQUIRED
if (airport.city === 'Moscow') ...          // OK
```

### ❌ FORBIDDEN - Regex on plain text
```javascript
// ❌ WRONG - NEVER DO THIS
const flightMatch = text.match(/Flight\s+(\w+\s+\d+)/);  // FORBIDDEN
const dateMatch = text.match(/\d{2}\/\d{2}\/\d{4}/);    // FORBIDDEN
```

```javascript
// ✅ CORRECT - Parse tree structure
tree.traverse(node => {
  if (node.type === 'text' && node.metadata.fontSize > 12) ...
});
```

### ❌ FORBIDDEN - Hardcoded flight number patterns
```javascript
// ❌ WRONG - NEVER DO THIS
if (flightNumber.match(/^JU\s+\d+$/)) ...  // FORBIDDEN
if (airlineCode === 'JAT') ...             // FORBIDDEN
```

### ✅ ALLOWED - Only for parser detection
```javascript
// ✅ OK - ONLY for canParse() detection
findText(tree, 'JAT Airways')  // OK to detect airline format
findText(tree, 'Aviakassa')    // OK to detect booking format
```

## Project Overview

This is a flight itinerary parser that converts PDF itinerary documents to ICS calendar files for importing into calendar applications. The project extracts structured flight information from various PDF formats and generates standard calendar events.

Key components:
- PDF parsing using PDF.js library
- Tree-based document structure analysis (never uses regex on raw text)
- Airport data from ICAO JSON database (data/airports.json)
- Outputs ICS files with flight information for calendar import

Required fields for ICS generation:
- Flight number (e.g., "JU 137")
- Departure airport IATA code (e.g., "SVO") with datetime
- Arrival airport IATA code (e.g., "BEG") with datetime

Optional fields: airline name, terminal, seat, class, passenger name, booking reference

Runtime: Bun runtime with vanilla JavaScript (no frameworks or additional dependencies)

## Code Principles

1. **No new dependencies** - Only use existing dependencies in the codebase
2. **No JS frameworks** - Use vanilla JavaScript
3. **Tree-based parsing only** - Never dump PDF to text + regex; always parse structure
4. **No hardcoded specific information**:
   - Never hardcode flight number patterns (e.g., `/^JU\s+\d+$/`)
   - Never hardcode airport names, city names, or airline names
   - Use data/airports.json for airport lookups (name, city, country, location, timezone)
   - Hardcoded names only allowed to detect which parser to use

**Code examples must pass this test:**
```javascript
// ❌ FORBIDDEN
if (airline === 'Aeroflot' || airline === 'S7') { ... }  // NO
if (city === 'Moscow') { ... }                            // NO
const pattern = /^JU\s+\d+$/;                             // NO

// ✅ REQUIRED
const airport = airportLookup(iata);                      // YES
const airlines = knownAirlines.filter(a =>                // YES
  a.countries.includes(airport.country)
);
```

## Text Processing

- Look for English text only
- Never parse Russian letters

## Parsing Rules

- Always parse the document structure (tree-based)
- Never use regex-based extraction on raw text
- Maintain structured context from document

## Self-Verification Checklist

**Before completing any parser code, answer these questions:**

- [ ] Did I use `airportLookup(iata)` instead of hardcoding airport/city names?
- [ ] Did I traverse the tree structure instead of using regex on raw text?
- [ ] Are all IATA codes validated against data/airports.json?
- [ ] Did I avoid hardcoded airline names or flight number patterns?
- [ ] Did I only hardcode names in `canParse()` for detection purposes?
- [ ] Does my code work with any airport/airline, not just specific ones?
- [ ] Did I validate the results with comprehensive tests?

## Implementing New Parsers

## When to Add a New Parser

When you receive a PDF example with a format not recognized by existing parsers, create a new parser following this workflow.

### Step 1: Inspect the PDF Structure

First, understand the PDF document structure before writing parser code:

**Option A: Using pdftotext (quick inspection)**
```bash
pdftotext -layout /path/to/new-example.pdf -
```

**Option B: Using Bun inline script (recommended for understanding layout)**
```bash
bun -e "
import { buildPDFTree, TextExtractionVisitor } from './src/extract-pdf-tree.js';
import { readFileSync } from 'node:fs';

const pdfBuffer = readFileSync('/path/to/new-example.pdf');
const tree = await buildPDFTree(pdfBuffer);

// Pretty print the tree structure
function printTree(node, indent = 0) {
  const prefix = '  '.repeat(indent);
  if (node.type === 'text') {
    console.log(\`\${prefix}[\${node.type}] "\${node.text}" (fs:\${node.metadata.fontSize}, font:\${node.metadata.fontFamily})\`);
  } else if (node.type === 'line') {
    console.log(\`\${prefix}[\${node.type}] y:\${node.bbox?.y}\`);
    for (const child of node.children) {
      printTree(child, indent + 1);
    }
  } else if (node.type === 'page') {
    console.log(\`\${prefix}[\${node.type}] #\${node.metadata.pageNumber}\`);
    for (const child of node.children) {
      printTree(child, indent + 1);
    }
  } else {
    console.log(\`\${prefix}[\${node.type}]\`);
    for (const child of node.children || []) {
      printTree(child, indent + 1);
    }
  }
}

printTree(tree);
"
```

Key things to look for:
- How flight information is positioned (tables, blocks, scattered lines)
- Font characteristics (size, family) of flight-related text
- Spatial relationships between flight number, airports, dates, times
- Unique patterns that identify this format (e.g., specific company name, layout)

### 2. Create the Parser

1. Extend `FlightParser` from `src/parsers/base.js`
2. Implement `name` getter (e.g., 'NewAirlineParser')
3. Implement `canParse()` to detect your format
4. Implement `parse()` to extract flight legs

```javascript
import { FlightParser } from './base.js';

class NewAirlineParser extends FlightParser {
  get name() { return 'NewAirlineParser'; }

  canParse(tree) {
    // Must check if input is a tree (not string)
    if (typeof tree === 'string') {
      return false;
    }

    // Detection logic - use tree traversal, not regex
    // Look for unique patterns in company name, layout, fonts, etc.
    // Return true only if this format is clearly recognized
  }

  parse(tree, airportLookup) {
    // Extract flight legs using tree structure
    // Always use airportLookup to validate IATA codes
    // Return array of FlightLeg objects matching the schema
  }
}

export { NewAirlineParser };
```

**Detection guidelines:**
- Look for company name or unique markers in tree structure
- Check font characteristics (size, family) of flight information
- Verify spatial layout patterns
- Be conservative - only return true if format is clearly identified

**Extraction guidelines:**
- Traverse tree using visitor pattern or spatial analysis
- Use `airportLookup(iata)` to validate airport codes
- Parse dates/times using helper functions or your own logic
- Return standardized FlightLeg objects

### Step 3: Register the Parser

Add to `src/parsers/index.js`:

```javascript
import { NewAirlineParser } from './new-airline.js';

const PARSERS = [
  new NewAirlineParser(),  // Add in appropriate priority order
  // ... other parsers
];
```

### Step 4: Write Comprehensive Tests

Create a comprehensive test case in `tests/parser.test.js` or `tests/tree-parser.test.js`:

```javascript
test('parses NewAirline ticket (filename)', async () => {
  const pdfBuffer = readFileSync(join(FIXTURES, 'new_airline_example.pdf'));
  const tree = await buildPDFTree(pdfBuffer);
  
  const { parser, legs } = parse(tree, lookupIATA);
  
  console.log(`  [NewAirline ticket] parser=${parser}, legs=${legs.length}`);
  
  // Check parser was selected
  expect(parser).toBe('NewAirlineParser');
  
  // Check number of flights
  expect(legs.length).toBeGreaterThan(0);
  
  // Verify each field for every flight leg
  for (const leg of legs) {
    // Required fields - verify each one
    expect(leg.flightNumber).toBeTruthy();
    expect(leg.flightNumber).toMatch(/^[A-Z]{2}\s+\d+$/);
    
    expect(leg.departure.iata).toMatch(/^[A-Z]{3}$/);
    expect(leg.arrival.iata).toMatch(/^[A-Z]{3}$/);
    expect(leg.departure.datetime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(leg.arrival.datetime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    
    // Validate airports exist in database
    expect(lookupIATA(leg.departure.iata)).not.toBeNull();
    expect(lookupIATA(leg.arrival.iata)).not.toBeNull();
  }
  
  // If multiple legs, verify sequence
  if (legs.length > 1) {
    expect(legs[0].arrival.iata).toBe(legs[1].departure.iata);
  }
});
```

**Test coverage requirements:**
- Parser selection verification
- Correct number of flight legs
- Every field in every leg is tested (flight number, departure/arrival IATA, datetimes)
- All airport codes validate against data/airports.json
- Multi-leg itineraries verify connection airports
- Edge cases (overnight flights, timezones, etc.)

### 5. Self-Verification

After writing parser code, run through the checklist above before considering it complete.

### Parser Implementation Best Practices

- **Always work with tree structure** - never use regex on raw text
- **Validate airport codes** - use `airportLookup(iata)` and reject unknown codes
- **Handle date arithmetic** - overnight flights need arrival day+1
- **Deduplicate** - same flight may appear multiple times in PDF
- **Sort results** - return legs in chronological order
- **Be conservative** - if format is ambiguous, don't parse

### Red Flag Patterns to Avoid

These patterns indicate violations that MUST be fixed:

- `if (text.includes('Moscow'))` → Use airport lookup
- `text.match(/Flight\s+(\w+)/)` → Parse tree structure  
- `if (airline === 'Aeroflot')` → Dynamic filtering
- `const pattern = /^JU\s+\d+$/` → Generic parsing
- Hardcoded arrays of airlines/cities → Use data sources
