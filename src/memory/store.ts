/**
 * Memory Store — Serena-style knowledge persistence for CodeAtlas
 *
 * Stores project-level knowledge as YAML-frontmatter Markdown files in:
 *   <project-root>/.codeatlas/memories/<slug>.md
 *
 * Files are human-editable, git-trackable, and session-persistent.
 * No DB dependency — pure filesystem CRUD.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
} from 'fs';
import { join } from 'path';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Memory {
  slug: string;
  title: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  content: string;
}

export interface MemoryMeta {
  slug: string;
  title: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

function memoriesDir(projectRoot: string): string {
  return join(projectRoot, '.codeatlas', 'memories');
}

function memoryPath(projectRoot: string, slug: string): string {
  return join(memoriesDir(projectRoot), `${slug}.md`);
}

// ─── Slug ─────────────────────────────────────────────────────────────────────

/**
 * Convert a title to a filesystem-safe slug.
 * e.g. "Project Overview" → "project-overview"
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// ─── Frontmatter parsing ──────────────────────────────────────────────────────

interface ParsedFile {
  meta: Record<string, unknown>;
  content: string;
}

function parseFrontmatter(raw: string): ParsedFile {
  // Match ---\n<yaml>\n---\n<body>
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { meta: {}, content: raw };
  }
  let meta: Record<string, unknown> = {};
  try {
    const parsed = yamlParse(match[1]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      meta = parsed as Record<string, unknown>;
    }
  } catch {
    // malformed frontmatter — treat as no meta
  }
  return { meta, content: match[2] };
}

function buildFrontmatter(meta: Record<string, unknown>, content: string): string {
  const yaml = yamlStringify(meta).trimEnd();
  return `---\n${yaml}\n---\n${content}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Ensure the memories directory exists. Idempotent.
 */
export function ensureMemoryDir(projectRoot: string): string {
  const dir = memoriesDir(projectRoot);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Write a new memory file. Overwrites if slug already exists.
 * Returns the created Memory object.
 */
export function writeMemory(
  projectRoot: string,
  slug: string,
  title: string,
  content: string,
  tags: string[] = [],
): Memory {
  ensureMemoryDir(projectRoot);
  const now = new Date().toISOString();
  const meta: Record<string, unknown> = {
    title,
    tags,
    created_at: now,
    updated_at: now,
  };
  const raw = buildFrontmatter(meta, content);
  writeFileSync(memoryPath(projectRoot, slug), raw, 'utf8');
  return { slug, title, tags, created_at: now, updated_at: now, content };
}

/**
 * Read a single memory file by slug.
 * Returns null if not found.
 */
export function readMemory(projectRoot: string, slug: string): Memory | null {
  const path = memoryPath(projectRoot, slug);
  if (!existsSync(path)) return null;

  const raw = readFileSync(path, 'utf8');
  const { meta, content } = parseFrontmatter(raw);

  return {
    slug,
    title: typeof meta['title'] === 'string' ? meta['title'] : slug,
    tags: Array.isArray(meta['tags'])
      ? (meta['tags'] as unknown[]).filter((t): t is string => typeof t === 'string')
      : [],
    created_at: typeof meta['created_at'] === 'string' ? meta['created_at'] : '',
    updated_at: typeof meta['updated_at'] === 'string' ? meta['updated_at'] : '',
    content,
  };
}

/**
 * List all memories in the project, optionally filtered by tag.
 * Returns metadata only (no content body).
 */
export function listMemories(projectRoot: string, tag?: string): MemoryMeta[] {
  const dir = memoriesDir(projectRoot);
  if (!existsSync(dir)) return [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  const results: MemoryMeta[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const slug = entry.slice(0, -3);
    const mem = readMemory(projectRoot, slug);
    if (!mem) continue;
    if (tag && !mem.tags.includes(tag)) continue;
    results.push({
      slug: mem.slug,
      title: mem.title,
      tags: mem.tags,
      created_at: mem.created_at,
      updated_at: mem.updated_at,
    });
  }

  // Sort by created_at descending
  results.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return results;
}

/**
 * Edit the content body of an existing memory.
 * Updates `updated_at`; merges new tags into existing ones.
 * Returns null if memory not found.
 */
export function editMemory(
  projectRoot: string,
  slug: string,
  content: string,
  tags?: string[],
): Memory | null {
  const existing = readMemory(projectRoot, slug);
  if (!existing) return null;

  const mergedTags = tags
    ? [...new Set([...existing.tags, ...tags])]
    : existing.tags;

  const now = new Date().toISOString();
  const meta: Record<string, unknown> = {
    title: existing.title,
    tags: mergedTags,
    created_at: existing.created_at,
    updated_at: now,
  };
  const raw = buildFrontmatter(meta, content);
  writeFileSync(memoryPath(projectRoot, slug), raw, 'utf8');

  return {
    slug,
    title: existing.title,
    tags: mergedTags,
    created_at: existing.created_at,
    updated_at: now,
    content,
  };
}

/**
 * Delete a memory file by slug.
 * Returns true if deleted, false if not found.
 */
export function deleteMemory(projectRoot: string, slug: string): boolean {
  const path = memoryPath(projectRoot, slug);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}
