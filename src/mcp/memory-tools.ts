/**
 * Memory Tools — MCP adapter for the memory store
 *
 * Resolves "project" parameter (name or absolute path) to a project root,
 * then delegates to src/memory/store.ts functions.
 */
import type { Db } from '../storage/database.js';
import { listProjects } from '../storage/queries.js';
import {
  slugify,
  writeMemory,
  readMemory,
  listMemories,
  editMemory,
  deleteMemory,
  type Memory,
  type MemoryMeta,
} from '../memory/store.js';

export { slugify };
export type { Memory, MemoryMeta };

// ─── Project resolution ───────────────────────────────────────────────────────

/**
 * Resolve a project name or absolute path to the project's root_path.
 * Returns null if not found in the DB.
 */
export function resolveProjectRoot(db: Db, projectRef: string): string | null {
  const projects = listProjects(db);
  const match = projects.find(
    p => p.name === projectRef || p.root_path === projectRef,
  );
  return match?.root_path ?? null;
}

// ─── Memory tool handlers ─────────────────────────────────────────────────────

export interface MemoryWriteArgs {
  project: string;
  title: string;
  content: string;
  tags?: string[];
}

export interface MemoryReadArgs {
  project: string;
  slug: string;
}

export interface MemoryListArgs {
  project: string;
  tag?: string;
}

export interface MemoryEditArgs {
  project: string;
  slug: string;
  content: string;
  tags?: string[];
}

export interface MemoryDeleteArgs {
  project: string;
  slug: string;
}

export type MemoryToolResult =
  | { ok: true; data: Memory | MemoryMeta[] | null; message: string }
  | { ok: false; error: string };

export function handleWriteMemory(db: Db, args: MemoryWriteArgs): MemoryToolResult {
  const root = resolveProjectRoot(db, args.project);
  if (!root) return { ok: false, error: `Project not found: ${args.project}` };

  const slug = slugify(args.title);
  if (!slug) return { ok: false, error: `Could not generate slug from title: "${args.title}"` };

  const memory = writeMemory(root, slug, args.title, args.content, args.tags ?? []);
  return {
    ok: true,
    data: memory,
    message: `Memory written: ${slug}.md`,
  };
}

export function handleReadMemory(db: Db, args: MemoryReadArgs): MemoryToolResult {
  const root = resolveProjectRoot(db, args.project);
  if (!root) return { ok: false, error: `Project not found: ${args.project}` };

  const memory = readMemory(root, args.slug);
  if (!memory) return { ok: false, error: `Memory not found: ${args.slug}` };

  return { ok: true, data: memory, message: '' };
}

export function handleListMemories(db: Db, args: MemoryListArgs): MemoryToolResult {
  const root = resolveProjectRoot(db, args.project);
  if (!root) return { ok: false, error: `Project not found: ${args.project}` };

  const memories = listMemories(root, args.tag);
  return { ok: true, data: memories, message: `${memories.length} memory file(s) found` };
}

export function handleEditMemory(db: Db, args: MemoryEditArgs): MemoryToolResult {
  const root = resolveProjectRoot(db, args.project);
  if (!root) return { ok: false, error: `Project not found: ${args.project}` };

  const updated = editMemory(root, args.slug, args.content, args.tags);
  if (!updated) return { ok: false, error: `Memory not found: ${args.slug}` };

  return {
    ok: true,
    data: updated,
    message: `Memory updated: ${args.slug}.md (updated_at: ${updated.updated_at})`,
  };
}

export function handleDeleteMemory(db: Db, args: MemoryDeleteArgs): MemoryToolResult {
  const root = resolveProjectRoot(db, args.project);
  if (!root) return { ok: false, error: `Project not found: ${args.project}` };

  const deleted = deleteMemory(root, args.slug);
  if (!deleted) return { ok: false, error: `Memory not found: ${args.slug}` };

  return { ok: true, data: null, message: `Memory deleted: ${args.slug}.md` };
}

// ─── Format helpers (for MCP text responses) ──────────────────────────────────

export function formatMemory(memory: Memory): string {
  const tags = memory.tags.length > 0 ? `[${memory.tags.join(', ')}]` : '(no tags)';
  return [
    `# ${memory.title}`,
    `slug: ${memory.slug} | tags: ${tags}`,
    `created: ${memory.created_at} | updated: ${memory.updated_at}`,
    '',
    memory.content,
  ].join('\n');
}

export function formatMemoryList(memories: MemoryMeta[]): string {
  if (memories.length === 0) return 'No memories found.';
  return memories.map(m => {
    const tags = m.tags.length > 0 ? ` [${m.tags.join(', ')}]` : '';
    return `${m.slug}${tags}\n  "${m.title}" — updated ${m.updated_at}`;
  }).join('\n\n');
}
