import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

interface ChunkMetadata {
  startIndex: number;
  length: number;
  [key: string]: any;
}

export interface DocumentChunk {
  content: string;
  metadata: ChunkMetadata;
}

/**
 * Split document text into chunks for RAG (Retrieval-Augmented Generation).
 * Uses RecursiveCharacterTextSplitter for semantic coherence.
 * 
 * @param text The full text of the document
 * @param chunkSize Target size of each chunk in characters
 * @param chunkOverlap Number of characters to overlap between chunks
 * @param metadata Extra metadata to attach to each chunk
 */
export async function chunkDocument(
  text: string,
  chunkSize: number = 1000,
  chunkOverlap: number = 200,
  metadata: Record<string, any> = {}
): Promise<DocumentChunk[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
  });

  const docs = await splitter.createDocuments([text]);

  let searchFrom = 0;
  return docs.map((doc, index) => {
    // `indexOf(content)` always points at the first occurrence for repeated
    // paragraphs. Search from the previous chunk while allowing the configured
    // overlap so provenance offsets remain monotonic and useful.
    const startIndex = text.indexOf(
      doc.pageContent,
      Math.max(0, searchFrom - chunkOverlap),
    );
    const resolvedStart = startIndex >= 0 ? startIndex : Math.max(0, searchFrom);
    searchFrom = resolvedStart + doc.pageContent.length;
    return {
      content: doc.pageContent,
      metadata: {
        ...metadata,
        startIndex: resolvedStart,
        length: doc.pageContent.length,
        chunkIndex: index,
      },
    };
  });
}
