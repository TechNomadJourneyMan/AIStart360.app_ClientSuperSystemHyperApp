import * as XLSX from "xlsx";
import { ocrImageBuffer, ocrPdfBuffer, shouldFallbackToOcr } from "@/lib/documents/ocr";

export type DocumentType =
  | "pdf"
  | "docx"
  | "xlsx"
  | "csv"
  | "txt"
  | "md"
  | "image"
  | "pptx"
  | "unknown";

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
  const ext = fileName.toLowerCase().split(".").pop()?.split(/[?#]/, 1)[0];
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
  if (mimeType === "text/csv" || ext === "csv") return "csv";
  if (mimeType === "text/plain" || ext === "txt") return "txt";
  if (mimeType === "text/markdown" || ext === "md") return "md";
  if (mimeType?.startsWith("image/") || ["png", "jpg", "jpeg"].includes(ext ?? "")) {
    return "image";
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    ext === "pptx"
  ) {
    return "pptx";
  }
  return "unknown";
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

/**
 * Decode the text formats we receive from accounting/CRM exports without
 * silently retaining a BOM or turning UTF-16 CSV files into NUL-filled text.
 * Legacy Windows-1251 remains a best-effort UTF-8 decode because Node does not
 * ship a CP1251 decoder and we intentionally avoid adding a new dependency.
 */
function decodeTextBuffer(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString("utf16le");
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  return buffer.toString("utf8").replace(/^\uFEFF/, "");
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
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
      // pdf-parse >=2 uses an explicit parser instance (the old callable
      // default export no longer exists). Always destroy it so Vercel
      // functions do not retain worker/canvas resources between invocations.
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buffer });
      let data: Awaited<ReturnType<typeof parser.getText>>;
      try {
        data = await parser.getText();
      } finally {
        await parser.destroy().catch(() => undefined);
      }

      let text = data.text.trim();
      if (
        shouldFallbackToOcr(text, buffer.byteLength) &&
        process.env.ENABLE_DOCUMENT_OCR !== "false"
      ) {
        const ocr = await ocrPdfBuffer(buffer, { maxPages: 10 });
        if (ocr?.text.trim()) text = ocr.text.trim();
      }

      return {
        text,
        metadata: {
          type: "pdf",
          pages: data.total,
          wordCount: countWords(text),
          fileName,
        },
      };
    }

    case "docx": {
      // eslint-disable-next-line
      const mammothModule = await import("mammoth") as any;
      const mammoth = mammothModule.default ?? mammothModule;
      const result = await mammoth.extractRawText({ buffer });
      return {
        text: result.value.trim(),
        metadata: {
          type: "docx",
          wordCount: countWords(result.value),
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
          wordCount: countWords(text),
          fileName,
        },
      };
    }

    case "txt": {
      const text = decodeTextBuffer(buffer);
      return {
        text: text.trim(),
        metadata: {
          type: "txt",
          wordCount: countWords(text),
          fileName,
        },
      };
    }

    case "md": {
      const text = decodeTextBuffer(buffer);
      return {
        text: text.trim(),
        metadata: {
          type: "md",
          wordCount: countWords(text),
          fileName,
        },
      };
    }

    case "csv": {
      const text = decodeTextBuffer(buffer);
      return {
        text: text.trim(),
        metadata: {
          type: "csv",
          wordCount: countWords(text),
          fileName,
        },
      };
    }

    case "image": {
      if (process.env.ENABLE_DOCUMENT_OCR === "false") {
        throw new Error("OCR изображений отключён");
      }
      const ocr = await ocrImageBuffer(buffer);
      const text = ocr?.text.trim() ?? "";
      return {
        text,
        metadata: {
          type: "image",
          pages: 1,
          wordCount: countWords(text),
          fileName,
        },
      };
    }

    case "pptx": {
      const { default: JSZip } = await import("jszip");
      const archive = await JSZip.loadAsync(buffer);
      const slides = Object.keys(archive.files)
        .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
        .sort((a, b) => {
          const an = Number(a.match(/slide(\d+)\.xml/i)?.[1] ?? 0);
          const bn = Number(b.match(/slide(\d+)\.xml/i)?.[1] ?? 0);
          return an - bn;
        });
      const slideTexts: string[] = [];
      for (const [index, path] of slides.entries()) {
        const xml = await archive.file(path)?.async("string");
        if (!xml) continue;
        const text = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/gi)]
          .map((match) => decodeXmlText(match[1]).trim())
          .filter(Boolean)
          .join(" ");
        if (text) slideTexts.push(`[Slide ${index + 1}]\n${text}`);
      }
      const text = slideTexts.join("\n\n");
      return {
        text,
        metadata: {
          type: "pptx",
          pages: slides.length,
          wordCount: countWords(text),
          fileName,
        },
      };
    }

    default:
      throw new Error(
        `Unsupported document type for file: ${fileName}. Supported: PDF, DOCX, XLSX, XLS, CSV, TXT, MD, PNG, JPG, JPEG, PPTX`
      );
  }
}
