/**
 * VectorStore — LanceDB wrapper for code embeddings
 *
 * Usage:
 *   const store = await VectorStore.open('~/.codeatlas/vectors');
 *   await store.upsert(records);
 *   const results = await store.search(queryVector, { kind: 'file', limit: 10 });
 */
import * as lancedb from '@lancedb/lancedb';
import { mkdirSync } from 'fs';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VectorRecord {
  /** "file:{file_id}" or "sym:{symbol_id}" */
  id: string;
  text: string;
  vector: number[];
  kind: 'file' | 'symbol';
  projectId: number;
  /** JSON string: { relative_path, symbol_name?, symbol_kind? } */
  metadata: string;
}

export interface SearchResult {
  id: string;
  kind: 'file' | 'symbol';
  /** L2 distance — lower = more similar */
  score: number;
  text: string;
  metadata: string;
}

export interface SearchOptions {
  kind?: 'file' | 'symbol';
  projectId?: number;
  limit?: number;
}

// ─── VectorStore ──────────────────────────────────────────────────────────────

const TABLE_NAME = 'embeddings';

export class VectorStore {
  private constructor(
    private readonly conn: lancedb.Connection,
    private readonly dbPath: string,
  ) {}

  /** Open (or create) a LanceDB vector store at `dbPath` */
  static async open(dbPath: string): Promise<VectorStore> {
    mkdirSync(dbPath, { recursive: true });
    const conn = await lancedb.connect(dbPath);
    return new VectorStore(conn, dbPath);
  }

  /**
   * Upsert records into the store.
   * If a record with the same `id` exists it will be replaced.
   */
  async upsert(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return;

    // Convert to LanceDB-compatible rows: vector must be Float32Array
    const rows = records.map(r => ({
      id: r.id,
      text: r.text,
      vector: new Float32Array(r.vector),
      kind: r.kind,
      projectId: r.projectId,
      metadata: r.metadata,
    }));

    const tableNames = await this.conn.tableNames();
    if (!tableNames.includes(TABLE_NAME)) {
      // Create table on first write
      await this.conn.createTable(TABLE_NAME, rows);
      return;
    }

    const table = await this.conn.openTable(TABLE_NAME);
    await table
      .mergeInsert('id')
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute(rows);
  }

  /**
   * Search for the nearest neighbors of `vector`.
   * Optionally filter by `kind` and `projectId`.
   */
  async search(vector: number[], opts: SearchOptions = {}): Promise<SearchResult[]> {
    const { kind, projectId, limit = 10 } = opts;

    const tableNames = await this.conn.tableNames();
    if (!tableNames.includes(TABLE_NAME)) return [];

    const table = await this.conn.openTable(TABLE_NAME);

    // Build SQL filter
    const filters: string[] = [];
    if (kind) filters.push(`kind = '${kind}'`);
    if (projectId !== undefined) filters.push(`projectId = ${projectId}`);

    let query = table
      .vectorSearch(new Float32Array(vector))
      .limit(limit)
      .select(['id', 'kind', 'text', 'metadata', 'projectId', '_distance']);

    if (filters.length > 0) {
      query = query.where(filters.join(' AND ')) as typeof query;
    }

    const raw = await query.toArray();
    return raw.map((row: Record<string, unknown>) => ({
      id: row['id'] as string,
      kind: row['kind'] as 'file' | 'symbol',
      score: row['_distance'] as number,
      text: row['text'] as string,
      metadata: row['metadata'] as string,
    }));
  }

  /** Delete all records belonging to a project */
  async deleteByProject(projectId: number): Promise<void> {
    const tableNames = await this.conn.tableNames();
    if (!tableNames.includes(TABLE_NAME)) return;

    const table = await this.conn.openTable(TABLE_NAME);
    await table.delete(`projectId = ${projectId}`);
  }
}
