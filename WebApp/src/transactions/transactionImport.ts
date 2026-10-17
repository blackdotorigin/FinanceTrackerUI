export type ImportSheet = {
  headers: string[];
  rows: { sourceRow: number; cells: string[] }[];
  date1904?: boolean;
};

export type ImportRow = {
  sourceRow: number;
  date: string;
  description: string;
  amount: string;
  debit: string;
  credit: string;
  currency: string;
  type: string;
  paymentMode: string;
  categoryValue: string;
  subcategoryValue: string;
  categoryId: string;
  subCategoryId: string;
  categoryIssue: string;
  subcategoryIssue: string;
  serverErrors: string[];
};

type ColumnName =
  | "date"
  | "description"
  | "amount"
  | "debit"
  | "credit"
  | "category"
  | "subcategory"
  | "currency"
  | "type"
  | "paymentMode";

const HEADER_ALIASES: Record<ColumnName, string[]> = {
  date: ["date", "transactionDate", "valueDate", "postingDate"],
  description: ["description", "narration", "particulars", "details", "transactionDetails", "merchant"],
  amount: ["amount", "transactionAmount"],
  debit: ["debit", "withdrawal", "moneyOut"],
  credit: ["credit", "deposit", "moneyIn"],
  category: ["category", "categoryName", "categoryId"],
  subcategory: ["subcategory", "subcategoryName", "subcategoryId"],
  currency: ["currency", "currencyCode"],
  type: ["type", "transactionType"],
  paymentMode: ["paymentMode", "paymentMethod", "mode"],
};

export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        value += character;
      }
    } else if (character === '"' && value.length === 0) {
      quoted = true;
    } else if (character === ",") {
      record.push(value);
      value = "";
    } else if (character === "\n" || character === "\r") {
      record.push(value);
      value = "";
      records.push(record);
      record = [];
      if (character === "\r" && text[index + 1] === "\n") index += 1;
    } else {
      value += character;
    }
  }
  if (quoted) throw new Error("The CSV file contains an unterminated quoted value.");
  record.push(value);
  if (record.some((cell) => cell.trim())) records.push(record);
  return records;
}

function normalizeEntryName(path: string) {
  const segments: string[] = [];
  for (const segment of path.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.join("/");
}

async function readZipEntry(
  bytes: Uint8Array,
  view: DataView,
  entry: { name: string; method: number; compressedSize: number; localOffset: number },
  maximumOutputBytes: number,
) {
  const offset = entry.localOffset;
  if (view.getUint32(offset, true) !== 0x04034b50) {
    throw new Error("The XLSX workbook contains an invalid file entry.");
  }
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const dataOffset = offset + 30 + nameLength + extraLength;
  const compressed = bytes.slice(dataOffset, dataOffset + entry.compressedSize);
  if (entry.method === 0) {
    if (compressed.length > maximumOutputBytes) {
      throw new Error("The XLSX workbook expands beyond the supported size.");
    }
    return compressed;
  }
  if (entry.method !== 8 || typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot read the compressed XLSX workbook. Try exporting it as CSV.");
  }
  const stream = new Blob([compressed]).stream().pipeThrough(
    new DecompressionStream("deflate-raw"),
  );
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let outputSize = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    outputSize += value.length;
    if (outputSize > maximumOutputBytes) {
      await reader.cancel();
      throw new Error("The XLSX workbook expands beyond the supported size.");
    }
    chunks.push(value);
  }
  const output = new Uint8Array(outputSize);
  let offsetInOutput = 0;
  for (const chunk of chunks) {
    output.set(chunk, offsetInOutput);
    offsetInOutput += chunk.length;
  }
  return output;
}

function parseXml(xml: string, name: string) {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror")) {
    throw new Error(`The XLSX workbook contains invalid ${name} data.`);
  }
  return document;
}

function readXmlText(element: Element, localName: string) {
  return Array.from(element.getElementsByTagNameNS("*", localName))
    .map((node) => node.textContent ?? "")
    .join("");
}

function excelColumnIndex(reference: string) {
  const letters = reference.match(/^[A-Z]+/i)?.[0].toUpperCase();
  if (!letters) return -1;
  let column = 0;
  for (const character of letters) column = column * 26 + character.charCodeAt(0) - 64;
  return column - 1;
}

export async function parseFirstWorksheet(file: File): Promise<ImportSheet> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOffset = -1;
  for (let offset = Math.max(0, bytes.length - 65_557); offset <= bytes.length - 22; offset += 1) {
    if (view.getUint32(offset, true) === 0x06054b50) endOffset = offset;
  }
  if (endOffset < 0) throw new Error("The XLSX file is not a valid ZIP-based workbook.");

  const entryCount = view.getUint16(endOffset + 10, true);
  let directoryOffset = view.getUint32(endOffset + 16, true);
  const entries = new Map<string, { name: string; method: number; compressedSize: number; localOffset: number }>();
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(directoryOffset, true) !== 0x02014b50) {
      throw new Error("The XLSX workbook contains an invalid ZIP directory.");
    }
    const method = view.getUint16(directoryOffset + 10, true);
    const compressedSize = view.getUint32(directoryOffset + 20, true);
    const nameLength = view.getUint16(directoryOffset + 28, true);
    const extraLength = view.getUint16(directoryOffset + 30, true);
    const commentLength = view.getUint16(directoryOffset + 32, true);
    const localOffset = view.getUint32(directoryOffset + 42, true);
    const name = new TextDecoder().decode(bytes.slice(directoryOffset + 46, directoryOffset + 46 + nameLength));
    entries.set(name, { name, method, compressedSize, localOffset });
    directoryOffset += 46 + nameLength + extraLength + commentLength;
  }

  let expandedSize = 0;
  const readEntry = async (name: string) => {
    const entry = entries.get(name);
    if (!entry) throw new Error(`The XLSX workbook is missing ${name}.`);
    const contents = await readZipEntry(bytes, view, entry, 25 * 1024 * 1024 - expandedSize);
    expandedSize += contents.byteLength;
    return new TextDecoder().decode(contents);
  };
  const workbook = parseXml(await readEntry("xl/workbook.xml"), "workbook");
  const workbookProperties = workbook.getElementsByTagNameNS("*", "workbookPr")[0];
  const date1904 = workbookProperties?.getAttribute("date1904") === "1" ||
    workbookProperties?.getAttribute("date1904") === "true";
  const firstSheet = workbook.getElementsByTagNameNS("*", "sheet")[0];
  const relationId = firstSheet?.getAttribute("r:id")
    ?? firstSheet?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
  if (!relationId) throw new Error("The XLSX workbook does not contain a worksheet.");
  const relationships = parseXml(await readEntry("xl/_rels/workbook.xml.rels"), "worksheet relationship");
  const worksheetTarget = Array.from(relationships.getElementsByTagNameNS("*", "Relationship"))
    .find((relationship) => relationship.getAttribute("Id") === relationId)
    ?.getAttribute("Target");
  if (!worksheetTarget) throw new Error("The first XLSX worksheet could not be found.");
  const worksheetPath = normalizeEntryName(worksheetTarget.startsWith("/")
    ? worksheetTarget
    : `xl/${worksheetTarget}`);
  const worksheet = parseXml(await readEntry(worksheetPath), "worksheet");

  const sharedStrings: string[] = [];
  if (entries.has("xl/sharedStrings.xml")) {
    const strings = parseXml(await readEntry("xl/sharedStrings.xml"), "shared strings");
    for (const item of Array.from(strings.getElementsByTagNameNS("*", "si"))) {
      sharedStrings.push(readXmlText(item, "t"));
    }
  }
  const rows = Array.from(worksheet.getElementsByTagNameNS("*", "row"));
  const records = rows.map((row, index) => {
    const values: string[] = [];
    for (const cell of Array.from(row.getElementsByTagNameNS("*", "c"))) {
      const column = excelColumnIndex(cell.getAttribute("r") ?? "");
      if (column < 0) continue;
      const type = cell.getAttribute("t");
      const valueElement = cell.getElementsByTagNameNS("*", "v")[0];
      let value = valueElement?.textContent ?? "";
      if (type === "s") {
        const sharedString = sharedStrings[Number(value)];
        if (sharedString === undefined) throw new Error("The XLSX workbook contains an invalid shared string.");
        value = sharedString;
      } else if (type === "inlineStr") {
        value = readXmlText(cell, "t");
      } else if (type === "b") {
        value = value === "1" ? "TRUE" : "FALSE";
      }
      values[column] = value;
    }
    return {
      sourceRow: Number(row.getAttribute("r")) || index + 1,
      cells: values.map((value) => value ?? ""),
    };
  });
  const headerIndex = records.findIndex(({ cells }) => cells.some((cell) => cell.trim()));
  if (headerIndex < 0) throw new Error("The XLSX worksheet is empty.");
  const [header, ...data] = records.slice(headerIndex);
  return {
    headers: header.cells,
    rows: data.filter(({ cells }) => cells.some((cell) => cell.trim())),
    date1904,
  };
}

function findColumn(headers: string[], name: ColumnName) {
  const aliases = new Set(HEADER_ALIASES[name].map((alias) => alias.toLowerCase().replace(/[^a-z0-9]/g, "")));
  const matches = headers.flatMap((header, index) =>
    aliases.has(header.toLowerCase().replace(/[^a-z0-9]/g, "")) ? [index] : [],
  );
  if (matches.length > 1) {
    throw new Error(`The file contains more than one column recognized as ${name}.`);
  }
  return matches[0];
}

export function mapImportSheet(sheet: ImportSheet, excelDates = false) {
  const columns = Object.fromEntries(
    (Object.keys(HEADER_ALIASES) as ColumnName[]).map((name) => [name, findColumn(sheet.headers, name)]),
  ) as Record<ColumnName, number | undefined>;
  if (columns.date === undefined || columns.description === undefined) {
    throw new Error("The header row must include date and description columns.");
  }
  const hasAmount = columns.amount !== undefined;
  const hasDebitCredit = columns.debit !== undefined && columns.credit !== undefined;
  if (!hasAmount && !hasDebitCredit) {
    throw new Error("The header row must include amount, or both debit and credit columns.");
  }
  if (hasAmount && (columns.debit !== undefined || columns.credit !== undefined)) {
    throw new Error("Use either an amount column or debit and credit columns, not both.");
  }

  const rows: ImportRow[] = sheet.rows
    .filter(({ cells }) => cells.some((cell) => cell.trim()))
    .map(({ sourceRow, cells }) => {
      const dateValue = columns.date === undefined ? "" : cells[columns.date] ?? "";
      const excelSerial = excelDates && /^\d+(?:\.\d+)?$/.test(dateValue)
        ? Number(dateValue)
        : Number.NaN;
      const date = Number.isFinite(excelSerial)
        ? new Date(Date.UTC(
            sheet.date1904 ? 1904 : 1899,
            sheet.date1904 ? 0 : 11,
            sheet.date1904 ? 1 : 30,
          ) + Math.floor(excelSerial) * 86_400_000).toISOString().slice(0, 10)
        : dateValue;
      return {
        sourceRow,
        date,
        description: cells[columns.description!] ?? "",
        amount: columns.amount === undefined ? "" : cells[columns.amount] ?? "",
        debit: columns.debit === undefined ? "" : cells[columns.debit] ?? "",
        credit: columns.credit === undefined ? "" : cells[columns.credit] ?? "",
        currency: columns.currency === undefined ? "" : cells[columns.currency] ?? "",
        type: columns.type === undefined ? "" : cells[columns.type] ?? "",
        paymentMode: columns.paymentMode === undefined ? "" : cells[columns.paymentMode] ?? "",
        categoryValue: columns.category === undefined ? "" : cells[columns.category] ?? "",
        subcategoryValue: columns.subcategory === undefined ? "" : cells[columns.subcategory] ?? "",
        categoryId: "",
        subCategoryId: "",
        categoryIssue: "",
        subcategoryIssue: "",
        serverErrors: [],
      };
    });
  if (rows.length > 1000) throw new Error("The file has more than 1,000 non-empty transaction rows.");
  return { rows, usesDebitCredit: hasDebitCredit };
}

export function escapeCsv(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
