/**
 * Semantic Search handler — decoupled from MCP transport for testability.
 *
 * handleSemanticSearch() contains all the logic; server.ts calls it from the
 * semantic_search tool handler.
 */
import type { Embedder } from './embedder.js';
import type { VectorStore, SearchResult } from './vector-store.js';

export interface SemanticSearchParams {
  query: string;
  project?: string;
  kind?: 'file' | 'symbol';
  limit?: number;
}

export type ProjectResolver = (name: string) => { id: number; name: string; root_path: string } | null;

/**
 * Perform a semantic search and return a human-readable result string.
 *
 * @param params    Search parameters from MCP tool input
 * @param embedder  Embedder instance
 * @param store     VectorStore instance, or null if not yet initialized (user hasn't run `embed`)
 * @param resolveProject  Function that resolves a project name/path to a project record
 */
export async function handleSemanticSearch(
  params: SemanticSearchParams,
  embedder: Embedder,
  store: VectorStore | null,
  resolveProject: ProjectResolver,
): Promise<string> {
  const { query, project, kind = 'file', limit = 10 } = params;

  // Graceful degradation: no vector store yet
  if (!store) {
    return [
      'Vector embeddings have not been generated yet.',
      'Run: codeatlas embed <project-name>',
      'Then restart the MCP server.',
    ].join('\n');
  }

  // Resolve optional project filter
  let projectId: number | undefined;
  if (project) {
    const p = resolveProject(project);
    if (!p) {
      return `Project not found: "${project}". Use list_projects to see available projects.`;
    }
    projectId = p.id;
  }

  // Embed query and search
  const queryVector = await embedder.embed(query);
  const results: SearchResult[] = await store.search(queryVector, { kind, projectId, limit });

  if (results.length === 0) {
    return 'No results found. Try a different query or run `codeatlas embed` to (re-)generate embeddings.';
  }

  return formatSearchResults(results, kind);
}

// ─── Result formatter ─────────────────────────────────────────────────────────

function formatSearchResults(results: SearchResult[], kind: 'file' | 'symbol'): string {
  const lines: string[] = [`Semantic search results (${results.length}):\n`];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const meta = safeParseJson(r.metadata);
    const score = r.score.toFixed(4);

    if (kind === 'symbol') {
      const symbolName = meta?.symbol_name ?? '(unknown)';
      const symbolKind = meta?.symbol_kind ?? '';
      const relPath = meta?.relative_path ?? r.id;
      lines.push(`${i + 1}. [${symbolKind}] ${symbolName}  (score: ${score})`);
      lines.push(`   ${relPath}`);
    } else {
      const relPath = meta?.relative_path ?? r.id;
      lines.push(`${i + 1}. ${relPath}  (score: ${score})`);
    }
  }

  return lines.join('\n');
}

function safeParseJson(s: string): Record<string, string> | null {
  try { return JSON.parse(s); } catch { return null; }
}
