import * as XLSX from "xlsx";

export type DocumentType = "pdf" | "docx" | "xlsx" | "txt" | "unknown";

export interface ParsedDocument {
  text: string;
  metadata: {
    type: DocumentType;
    pages?: number;
    wordCount: number;
    fileName: string;
  };
}

/**
 * Detect document type from MIME type or file extension.
 */
export function detectDocumentType(
  fileName: string,
  mimeType?: string
): DocumentType {
  const ext = fileName.toLowerCase().split(".").pop();
  if (mimeType === "application/pdf" || ext === "pdf") return "pdf";
  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx"
  )
    return "docx";
  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    ext === "xlsx" ||
    ext === "xls"
  )
    return "xlsx";
  if (mimeType === "text/plain" || ext === "txt") return "txt";
  return "unknown";
}

/**
 * Parse a Buffer or ArrayBuffer into plain text based on document type.
 * Used in the AI diagnostic intake pipeline.
 *
 * @example
 * const buffer = await file.arrayBuffer();
 * const doc = await parseDocument(Buffer.from(buffer), file.name);
 * console.log(doc.text); // extracted text for RAG chunking
 */
export async function parseDocument(
  buffer: Buffer,
  fileName: string,
  mimeType?: string
): Promise<ParsedDocument> {
  const docType = detectDocumentType(fileName, mimeType);

  switch (docType) {
    case "pdf": {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pdfModule = await import("pdf-parse") as any;
      const pdf = pdfModule.default ?? pdfModule;
      const data = await pdf(buffer);
      return {
        text: data.text.trim(),
        metadata: {
          type: "pdf",
          pages: data.numpages,
          wordCount: data.text.split(/\s+/).length,
          fileName,
        },
      };
    }

    case "docx": {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mammothModule = await import("mammoth") as any;
      const mammoth = mammothModule.default ?? mammothModule;
      const result = await mammoth.extractRawText({ buffer });
      return {
        text: result.value.trim(),
        metadata: {
          type: "docx",
          wordCount: result.value.split(/\s+/).length,
          fileName,
        },
      };
    }

    case "xlsx": {
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const texts: string[] = [];

      workbook.SheetNames.forEach((sheetName) => {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        texts.push(`[Sheet: ${sheetName}]\n${csv}`);
      });

      const text = texts.join("\n\n");
      return {
        text: text.trim(),
        metadata: {
          type: "xlsx",
          wordCount: text.split(/\s+/).length,
          fileName,
        },
      };
    }

    case "txt": {
      const text = buffer.toString("utf-8");
      return {
        text: text.trim(),
        metadata: {
          type: "txt",
          wordCount: text.split(/\s+/).length,
          fileName,
        },
      };
    }

    default:
      throw new Error(
        `Unsupported document type for file: ${fileName}. Supported: PDF, DOCX, XLSX, TXT`
      );
  }
}
