import { getDocument, GlobalWorkerOptions } from 'https://esm.sh/pdfjs-dist@5.6.205/legacy/build/pdf.mjs';

export function configurePDFWorker(workerSrc) {
  GlobalWorkerOptions.workerSrc = workerSrc ?? '';
}

class PDFTreeNode {
  constructor(type, text = '', bbox = null) {
    this.type = type;
    this.text = text;
    this.children = [];
    this.metadata = {};
    if (bbox) {
      this.bbox = bbox;
    }
  }

  addChild(child) {
    this.children.push(child);
    child.parent = this;
    return this;
  }

  findChildren(predicate) {
    return this.children.filter(predicate);
  }

  findDescendants(predicate) {
    const results = [];
    if (predicate(this)) {
      results.push(this);
    }
    for (const child of this.children) {
      results.push(...child.findDescendants(predicate));
    }
    return results;
  }

  accept(visitor) {
    visitor.visit(this);
    for (const child of this.children) {
      child.accept(visitor);
    }
  }
}

class PDFDocument extends PDFTreeNode {
  constructor() {
    super('document');
    this.pages = [];
  }

  addPage(page) {
    this.pages.push(page);
    this.addChild(page);
    return this;
  }
}

class PDFPage extends PDFTreeNode {
  constructor(pageNum, viewport) {
    super('page', '', {
      x: 0,
      y: 0,
      width: viewport.width,
      height: viewport.height,
    });
    this.pageNum = pageNum;
    this.metadata.pageNumber = pageNum;
    this.metadata.viewport = viewport;
    this.blocks = [];
  }

  addBlock(block) {
    this.blocks.push(block);
    this.addChild(block);
    return this;
  }

  addLine(line) {
    this.addChild(line);
    return this;
  }
}

class PDFBlock extends PDFTreeNode {
  constructor(type, bbox) {
    super(type, '', bbox);
    this.type = type;
    this.lines = [];
  }

  addLine(line) {
    this.lines.push(line);
    this.addChild(line);
    return this;
  }
}

class PDFLine extends PDFTreeNode {
  constructor(bbox) {
    super('line', '', bbox);
    this.items = [];
  }

  addItem(item) {
    this.items.push(item);
    this.addChild(item);
    return this;
  }
}

class PDFTextItem extends PDFTreeNode {
  constructor(text, bbox, fontSize, fontFamily) {
    super('text', text, bbox);
    this.metadata.fontSize = fontSize;
    this.metadata.fontFamily = fontFamily;
  }
}

class TreeBuildingVisitor {
  constructor() {
    this.root = new PDFDocument();
    this.currentPage = null;
    this.currentBlock = null;
    this.currentLine = null;
  }

  visit(node) {
    if (node instanceof PDFPage) {
      this.currentPage = node;
    }
  }

  getTree() {
    return this.root;
  }
}

class TextExtractionVisitor {
  constructor() {
    this.result = '';
  }

  visit(node) {
    if (node instanceof PDFTextItem) {
      this.result += node.text;
    } else if (node instanceof PDFLine) {
      this.result += '\n';
    } else if (node instanceof PDFPage) {
      this.result += '\n--- PAGE BREAK ---\n';
    }
  }

  getText() {
    return this.result;
  }
}

class SpatialAnalyzer {
  constructor(tolerance = 3) {
    this.tolerance = tolerance;
  }

  groupByY(items, tolerance = this.tolerance) {
    const groups = new Map();
    
    for (const item of items) {
      const y = Math.round(item.transform[5] / tolerance) * tolerance;
      
      if (!groups.has(y)) {
        groups.set(y, []);
      }
      groups.get(y).push(item);
    }
    
    return Array.from(groups.entries())
      .map(([y, items]) => ({ y, items }))
      .sort((a, b) => b.y - a.y);
  }

  sortByX(items) {
    return items.sort((a, b) => a.transform[4] - b.transform[4]);
  }

  calculateBBox(transform, str) {
    const x = transform[4];
    const y = transform[5];
    const width = transform[0] * str.length * 0.6;
    const height = transform[0];
    
    return { x, y, width, height };
  }

  mergeBBoxes(bboxes) {
    if (bboxes.length === 0) return null;
    
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    
    for (const bbox of bboxes) {
      if (bbox.x < minX) minX = bbox.x;
      if (bbox.y < minY) minY = bbox.y;
      if (bbox.x + bbox.width > maxX) maxX = bbox.x + bbox.width;
      if (bbox.y + bbox.height > maxY) maxY = bbox.y + bbox.height;
    }
    
    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }
}

class BlockDetector {
  constructor(analyzer) {
    this.analyzer = analyzer;
  }

  detectBlocks(lineGroups) {
    const blocks = [];
    let currentBlock = null;
    let lastY = null;
    const lineSpacingThreshold = 15;

    for (const lineGroup of lineGroups) {
      const lineY = lineGroup.y;

      if (currentBlock === null) {
        currentBlock = {
          lineGroups: [lineGroup],
          bbox: { ...lineGroup.bbox },
        };
      } else if (Math.abs(lineY - lastY) <= lineSpacingThreshold) {
        currentBlock.lineGroups.push(lineGroup);
        currentBlock.bbox = this.analyzer.mergeBBoxes([
          currentBlock.bbox,
          lineGroup.bbox,
        ]);
      } else {
        blocks.push(currentBlock);
        currentBlock = {
          lineGroups: [lineGroup],
          bbox: { ...lineGroup.bbox },
        };
      }

      lastY = lineY;
    }

    if (currentBlock) {
      blocks.push(currentBlock);
    }

    return blocks;
  }
}

export async function buildPDFTree(buffer, options = {}) {
  const {
    tolerance = 3,
    detectBlocks = true,
  } = options;

  const loadingTask = getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;

  const treeBuilder = new TreeBuildingVisitor();
  const tree = treeBuilder.getTree();
  const analyzer = new SpatialAnalyzer(tolerance);
  const blockDetector = detectBlocks ? new BlockDetector(analyzer) : null;

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.0 });
    const content = await page.getTextContent();

    const pdfPage = new PDFPage(i, viewport);
    tree.addPage(pdfPage);

    const lineGroups = analyzer.groupByY(content.items);

    for (const group of lineGroups) {
      analyzer.sortByX(group.items);

      const items = group.items;
      if (items.length === 0) continue;

      const bboxes = items.map(item => analyzer.calculateBBox(item.transform, item.str));
      const lineBBox = analyzer.mergeBBoxes(bboxes);
      const line = new PDFLine(lineBBox);

      for (let j = 0; j < items.length; j++) {
        const item = items[j];
        const itemBBox = bboxes[j];
        const fontSize = Math.abs(item.transform[0]);
        const fontFamily = item.fontName || 'unknown';

        const textItem = new PDFTextItem(
          normalizeText(item.str),
          itemBBox,
          fontSize,
          fontFamily
        );

        line.addItem(textItem);
      }

      pdfPage.addLine(line);
    }
  }

  return tree;
}

function normalizeText(str) {
  return str
    .replace(/\uE092/g, ':')
    .replace(/\uE088/g, ':')
    .replace(/\uff1a/g, ':')
    .replace(/\u2013| \u2014|\uff0d/g, '-')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function extractTextFromPDF(buffer) {
  const tree = await buildPDFTree(buffer);
  const visitor = new TextExtractionVisitor();
  tree.accept(visitor);
  return visitor.getText();
}

export {
  PDFTreeNode,
  PDFDocument,
  PDFPage,
  PDFBlock,
  PDFLine,
  PDFTextItem,
  TreeBuildingVisitor,
  TextExtractionVisitor,
  SpatialAnalyzer,
  BlockDetector,
};