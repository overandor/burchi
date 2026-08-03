import * as fs from "fs";
import * as path from "path";
import { ProcessedEmailRecord } from "@/types";

export async function exportToExcel(
  records: ProcessedEmailRecord[],
  outputPath: string
): Promise<string> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Mailbox Automation";
  workbook.created = new Date();

  const fieldsSheet = workbook.addWorksheet("Extracted Fields", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  fieldsSheet.columns = [
    { header: "Email Subject", key: "subject", width: 40 },
    { header: "Sender", key: "sender", width: 30 },
    { header: "Received Date", key: "receivedDate", width: 22 },
    { header: "Category", key: "category", width: 20 },
    { header: "Field Key", key: "fieldKey", width: 25 },
    { header: "Field Value", key: "fieldValue", width: 30 },
    { header: "Type", key: "type", width: 15 },
    { header: "Unit", key: "unit", width: 12 },
    { header: "Confidence", key: "confidence", width: 12 },
    { header: "Processed At", key: "processedAt", width: 22 },
  ];

  for (const record of records) {
    for (const field of record.extractedData.fields) {
      fieldsSheet.addRow({
        subject: record.subject,
        sender: record.sender,
        receivedDate: record.receivedDate,
        category: record.category,
        fieldKey: field.key,
        fieldValue: field.value,
        type: field.type,
        unit: field.unit || "",
        confidence: field.confidence,
        processedAt: record.processedAt,
      });
    }
  }

  styleHeaderRow(fieldsSheet);

  const tablesSheet = workbook.addWorksheet("Extracted Tables", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  tablesSheet.columns = [
    { header: "Email Subject", key: "subject", width: 40 },
    { header: "Table Name", key: "tableName", width: 25 },
    { header: "Source", key: "source", width: 20 },
    { header: "Row Data (JSON)", key: "rowData", width: 80 },
  ];

  for (const record of records) {
    for (const table of record.extractedData.tables) {
      for (const row of table.rows) {
        tablesSheet.addRow({
          subject: record.subject,
          tableName: table.name,
          source: table.source,
          rowData: JSON.stringify(row),
        });
      }
    }
  }

  styleHeaderRow(tablesSheet);

  const summarySheet = workbook.addWorksheet("Summary", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  summarySheet.columns = [
    { header: "Email Subject", key: "subject", width: 40 },
    { header: "Sender", key: "sender", width: 30 },
    { header: "Received Date", key: "receivedDate", width: 22 },
    { header: "Category", key: "category", width: 20 },
    { header: "Confidence", key: "confidence", width: 12 },
    { header: "Field Count", key: "fieldCount", width: 12 },
    { header: "Table Count", key: "tableCount", width: 12 },
    { header: "Summary", key: "summary", width: 60 },
    { header: "Processed At", key: "processedAt", width: 22 },
  ];

  for (const record of records) {
    summarySheet.addRow({
      subject: record.subject,
      sender: record.sender,
      receivedDate: record.receivedDate,
      category: record.category,
      confidence: record.confidence,
      fieldCount: record.fieldCount,
      tableCount: record.tableCount,
      summary: record.extractedData.summary,
      processedAt: record.processedAt,
    });
  }

  styleHeaderRow(summarySheet);

  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  }

  const filename = `export-${new Date().toISOString().replace(/[:.]/g, "-")}.xlsx`;
  const filepath = path.join(outputPath, filename);
  await workbook.xlsx.writeFile(filepath);

  return filepath;
}

export async function exportToCSV(
  records: ProcessedEmailRecord[],
  outputPath: string
): Promise<string> {
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  }

  const filename = `export-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
  const filepath = path.join(outputPath, filename);

  const headers = [
    "Email Subject", "Sender", "Received Date", "Category",
    "Field Key", "Field Value", "Type", "Unit", "Confidence",
    "Summary", "Processed At",
  ];

  const lines: string[] = [headers.join(",")];

  for (const record of records) {
    for (const field of record.extractedData.fields) {
      const row = [
        escapeCsv(record.subject),
        escapeCsv(record.sender),
        escapeCsv(record.receivedDate),
        escapeCsv(record.category),
        escapeCsv(field.key),
        escapeCsv(field.value),
        escapeCsv(field.type),
        escapeCsv(field.unit || ""),
        String(field.confidence),
        escapeCsv(record.extractedData.summary),
        escapeCsv(record.processedAt),
      ];
      lines.push(row.join(","));
    }
  }

  fs.writeFileSync(filepath, lines.join("\n"), "utf-8");
  return filepath;
}

function escapeCsv(value: string): string {
  if (!value) return "";
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function styleHeaderRow(sheet: any) {
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    bgColor: { argb: "FF4472C4" },
  };
  headerRow.alignment = { vertical: "middle", horizontal: "left" };
}
