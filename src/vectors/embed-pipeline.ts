/**
 * Embedding Pipeline — Orchestrates SQLite → document building → embedding → VectorStore
 *
 * Usage:
 *   const result = await embedProject(db, projectId, embedder, vectorStore);
 *   // result: { filesEmbedded, symbolsEmbedded, durationMs }
 */
import type { Db } from '../storage/database.js';
import { listFilesWithSummaries, getSymbolsByFile } from '../storage/queries.js';
import type { Symbol } from '../storage/queries.js';
import type { Embedder } from './embedder.js';
import type { VectorStore, VectorRecord } from './vector-store.js';

// ─── Top-level symbol kinds to embed ─────────────────────────────────────────

const TOP_LEVEL_KINDS = new Set(['class', 'interface', 'enum', 'record', 'annotation_type']);

// ─── Document builders ────────────────────────────────────────────────────────

/**
 * Build a composite text document for a file — combines path, symbols, and optional summary.
 * Used as input to the embedding model for file-level semantic search.
 */
export function buildFileDocument(
  relativePath: string,
  symbols: Pick<Symbol, 'name' | 'kind'>[],
  summary?: string,
): string {
  const parts: string[] = [];
  parts.push(`File: ${relativePath}`);

  if (symbols.length > 0) {
    const symbolLines = symbols.map(s => `[${s.kind}] ${s.name}`).join(', ');
    parts.push(`Symbols: ${symbolLines}`);
  }

  if (summary) {
    parts.push(`Summary: ${summary}`);
  }

  return parts.join('\n');
}

/**
 * Build a composite text document for a top-level symbol — name, kind, signature, annotations.
 * Used for symbol-level semantic search ("find classes that handle payment").
 */
export function buildSymbolDocument(
  symbol: Pick<Symbol, 'name' | 'kind' | 'signature' | 'annotations'>,
  relativePath: string,
): string {
  const parts: string[] = [];
  parts.push(`[${symbol.kind}] ${symbol.name}`);

  if (symbol.signature) {
    parts.push(`Signature: ${symbol.signature}`);
  }

  if (symbol.annotations) {
    try {
      const annotations: string[] = JSON.parse(symbol.annotations);
      if (annotations.length > 0) {
        parts.push(`Annotations: ${annotations.join(' ')}`);
      }
    } catch {
      // ignore malformed JSON
    }
  }

  parts.push(`File: ${relativePath}`);
  return parts.join('\n');
}

// ─── EmbedResult ─────────────────────────────────────────────────────────────

export interface EmbedResult {
  filesEmbedded: number;
  symbolsEmbedded: number;
  durationMs: number;
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

/**
 * Embed all files and top-level symbols in a project, storing results in VectorStore.
 */
export async function embedProject(
  db: Db,
  projectId: number,
  embedder: Embedder,
  vectorStore: VectorStore,
  opts: { verbose?: boolean } = {},
): Promise<EmbedResult> {
  const start = Date.now();
  const filesWithSummaries = listFilesWithSummaries(db, projectId);

  const fileRecords: VectorRecord[] = [];
  const symbolRecords: VectorRecord[] = [];

  for (const file of filesWithSummaries) {
    const symbols = getSymbolsByFile(db, file.id);
    const topLevelSymbols = symbols.filter(s => TOP_LEVEL_KINDS.has(s.kind) && !s.parent_id);

    // File-level document
    const fileDoc = buildFileDocument(
      file.relative_path,
      symbols.map(s => ({ name: s.name, kind: s.kind })),
      file.summary_content ?? undefined,
    );

    if (opts.verbose) {
      process.stdout.write(`  embedding ${file.relative_path}...\n`);
    }

    const fileVector = await embedder.embed(fileDoc);
    fileRecords.push({
      id: `file:${file.id}`,
      text: fileDoc,
      vector: fileVector,
      kind: 'file',
      projectId,
      metadata: JSON.stringify({ relative_path: file.relative_path }),
    });

    // Symbol-level documents (top-level only)
    for (const sym of topLevelSymbols) {
      const symDoc = buildSymbolDocument(sym, file.relative_path);
      const symVector = await embedder.embed(symDoc);
      symbolRecords.push({
        id: `sym:${sym.id}`,
        text: symDoc,
        vector: symVector,
        kind: 'symbol',
        projectId,
        metadata: JSON.stringify({
          relative_path: file.relative_path,
          symbol_name: sym.name,
          symbol_kind: sym.kind,
        }),
      });
    }
  }

  // Batch upsert
  if (fileRecords.length > 0) await vectorStore.upsert(fileRecords);
  if (symbolRecords.length > 0) await vectorStore.upsert(symbolRecords);

  return {
    filesEmbedded: fileRecords.length,
    symbolsEmbedded: symbolRecords.length,
    durationMs: Date.now() - start,
  };
}
