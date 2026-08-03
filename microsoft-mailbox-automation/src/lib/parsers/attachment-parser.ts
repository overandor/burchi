import { EmailAttachment, ParsedAttachmentData } from "@/types";

export async function parseAttachment(
  attachment: EmailAttachment
): Promise<ParsedAttachmentData> {
  const { contentType, name, content } = attachment;

  if (!content) {
    return { type: "unknown" };
  }

  const ext = name.split(".").pop()?.toLowerCase() || "";
  const buffer = Buffer.from(content);

  if (ext === "csv" || contentType === "text/csv") {
    return parseCSV(buffer);
  }

  if (ext === "xlsx" || ext === "xls" || contentType.includes("spreadsheet") || contentType.includes("excel")) {
    return parseExcel(buffer);
  }

  if (ext === "pdf" || contentType === "application/pdf") {
    return parsePDF(buffer);
  }

  if (ext === "txt" || contentType === "text/plain" || contentType.startsWith("text/")) {
    return {
      type: "text",
      text: buffer.toString("utf-8"),
    };
  }

  if (ext === "json" || contentType === "application/json") {
    try {
      const json = JSON.parse(buffer.toString("utf-8"));
      if (Array.isArray(json)) {
        return { type: "csv", rows: json };
      }
      return { type: "text", text: JSON.stringify(json, null, 2) };
    } catch {
      return { type: "text", text: buffer.toString("utf-8") };
    }
  }

  return { type: "unknown" };
}

async function parseCSV(buffer: Buffer): Promise<ParsedAttachmentData> {
  const Papa = (await import("papaparse")).default;
  const text = buffer.toString("utf-8");
  const result = Papa.parse(text, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  });

  return {
    type: "csv",
    rows: (result.data as Record<string, unknown>[]) || [],
    metadata: {
      rowCount: (result.data as any[]).length,
      headers: result.meta.fields || [],
    },
  };
}

async function parseExcel(buffer: Buffer): Promise<ParsedAttachmentData> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();

  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const allRows: Record<string, unknown>[] = [];
  const worksheet = workbook.worksheets[0];

  if (worksheet) {
    const headers: string[] = [];
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell, colNumber) => {
      headers[colNumber - 1] = String(cell.value || `Column${colNumber}`);
    });

    worksheet.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      const rowData: Record<string, unknown> = {};
      row.eachCell((cell, colNumber) => {
        const header = headers[colNumber - 1] || `Column${colNumber}`;
        rowData[header] = cell.value;
      });
      allRows.push(rowData);
    });
  }

  return {
    type: "excel",
    rows: allRows,
    metadata: {
      rowCount: allRows.length,
      sheetName: worksheet?.name || "Sheet1",
    },
  };
}

async function parsePDF(buffer: Buffer): Promise<ParsedAttachmentData> {
  try {
    const pdfParse = (await import("pdf-parse")).default;
    const data = await pdfParse(buffer);
    return {
      type: "pdf",
      text: data.text,
      metadata: {
        pages: data.numpages,
        info: data.info,
      },
    };
  } catch (e) {
    return {
      type: "pdf",
      text: "",
      metadata: { error: "Failed to parse PDF" },
    };
  }
}
