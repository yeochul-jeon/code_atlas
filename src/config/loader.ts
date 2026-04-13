// src/config/loader.ts
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'yaml';

export interface CodeAtlasConfig {
  indexer: {
    extensions: string[];
    skipDirs: string[];
  };
  deadCode: {
    excludeAnnotations: string[];
    replaceAnnotations: boolean;
    excludePatterns: string[];
  };
  summaries: {
    model: string;
  };
}

export const DEFAULT_EXTENSIONS: string[] = ['.java'];

export const DEFAULT_SKIP_DIRS: string[] = ['node_modules', 'build', 'target', '.gradle'];

export const DEFAULT_EXCLUDED_ANNOTATIONS: string[] = [
  '@RestController',
  '@Controller',
  '@Service',
  '@Component',
  '@Repository',
  '@Bean',
  '@Configuration',
  '@Override',
  '@WebAdapter',
  '@UseCase',
  '@PersistenceAdapter',
  '@ApiAdapter',
];

export const DEFAULT_MODEL = 'claude-sonnet-4-6';

function defaultConfig(): CodeAtlasConfig {
  return {
    indexer: {
      extensions: [...DEFAULT_EXTENSIONS],
      skipDirs: [...DEFAULT_SKIP_DIRS],
    },
    deadCode: {
      excludeAnnotations: [...DEFAULT_EXCLUDED_ANNOTATIONS],
      replaceAnnotations: false,
      excludePatterns: [],
    },
    summaries: {
      model: DEFAULT_MODEL,
    },
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function loadConfig(projectPath: string): CodeAtlasConfig {
  const configPath = join(projectPath, '.codeatlas.yaml');

  if (!existsSync(configPath)) {
    return defaultConfig();
  }

  let raw: unknown;
  try {
    raw = parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    process.stderr.write(
      `Warning: failed to parse ${configPath}: ${(err as Error).message}\n`,
    );
    return defaultConfig();
  }

  if (!raw || typeof raw !== 'object') {
    return defaultConfig();
  }

  const yaml = raw as Record<string, unknown>;
  const defaults = defaultConfig();

  // --- indexer section ---
  const indexerRaw = toRecord(yaml['indexer']);
  const extensions =
    indexerRaw && Array.isArray(indexerRaw['extensions'])
      ? toStringArray(indexerRaw['extensions'])
      : defaults.indexer.extensions;
  const skipDirs =
    indexerRaw && Array.isArray(indexerRaw['skip_dirs'])
      ? toStringArray(indexerRaw['skip_dirs'])
      : defaults.indexer.skipDirs;

  // --- dead_code section ---
  const deadCodeRaw = toRecord(yaml['dead_code']);
  const replaceAnnotations =
    deadCodeRaw && typeof deadCodeRaw['replace_annotations'] === 'boolean'
      ? deadCodeRaw['replace_annotations']
      : false;

  const userAnnotations =
    deadCodeRaw && Array.isArray(deadCodeRaw['exclude_annotations'])
      ? toStringArray(deadCodeRaw['exclude_annotations'])
      : null;

  const excludeAnnotations =
    userAnnotations === null
      ? defaults.deadCode.excludeAnnotations
      : replaceAnnotations
        ? userAnnotations
        : [...DEFAULT_EXCLUDED_ANNOTATIONS, ...userAnnotations];

  const excludePatterns =
    deadCodeRaw && Array.isArray(deadCodeRaw['exclude_patterns'])
      ? toStringArray(deadCodeRaw['exclude_patterns'])
      : [];

  // --- summaries section ---
  const summariesRaw = toRecord(yaml['summaries']);
  const model =
    summariesRaw && typeof summariesRaw['model'] === 'string'
      ? summariesRaw['model']
      : DEFAULT_MODEL;

  return {
    indexer: { extensions, skipDirs },
    deadCode: { excludeAnnotations, replaceAnnotations, excludePatterns },
    summaries: { model },
  };
}
