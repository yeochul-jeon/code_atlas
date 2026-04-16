// src/config/loader.ts
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'yaml';

export interface RemoteConfig {
  enabled: boolean;
  provider: 'graphiti' | 'none';
  endpoint: string;
  groupIdPrefix: string;
  pushOnGenerate: boolean;
  include: {
    memories: boolean;
    summaries: boolean;
    impactAnalyses: boolean;
  };
  auth: {
    type: 'none' | 'bearer';
    tokenEnv: string;
  };
}

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
  memory: {
    enabled: boolean;
    path: string;      // relative to project root
    autoOnboard: boolean;
  };
  remote: RemoteConfig;
}

export const DEFAULT_EXTENSIONS: string[] = [
  '.java',
  '.js', '.mjs', '.cjs', '.jsx',
  '.ts', '.mts', '.cts', '.tsx',
  '.vue',
];

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

export const DEFAULT_MEMORY_PATH = '.codeatlas/memories';

export const DEFAULT_REMOTE_CONFIG: RemoteConfig = {
  enabled: false,
  provider: 'graphiti',
  endpoint: 'http://localhost:8000/mcp',
  groupIdPrefix: 'codeatlas',
  pushOnGenerate: false,
  include: {
    memories: true,
    summaries: true,
    impactAnalyses: false,
  },
  auth: {
    type: 'none',
    tokenEnv: 'CODEATLAS_GRAPHITI_TOKEN',
  },
};

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
    memory: {
      enabled: true,
      path: DEFAULT_MEMORY_PATH,
      autoOnboard: true,
    },
    remote: { ...DEFAULT_REMOTE_CONFIG, include: { ...DEFAULT_REMOTE_CONFIG.include }, auth: { ...DEFAULT_REMOTE_CONFIG.auth } },
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

  // --- memory section ---
  const memoryRaw = toRecord(yaml['memory']);
  const memoryEnabled =
    memoryRaw && typeof memoryRaw['enabled'] === 'boolean'
      ? memoryRaw['enabled']
      : true;
  const memoryPath =
    memoryRaw && typeof memoryRaw['path'] === 'string'
      ? memoryRaw['path']
      : DEFAULT_MEMORY_PATH;
  const autoOnboard =
    memoryRaw && typeof memoryRaw['auto_onboard'] === 'boolean'
      ? memoryRaw['auto_onboard']
      : true;

  // --- remote section ---
  const D = DEFAULT_REMOTE_CONFIG;
  const remoteRaw = toRecord(yaml['remote']);
  const remoteEnabled =
    remoteRaw && typeof remoteRaw['enabled'] === 'boolean'
      ? remoteRaw['enabled']
      : D.enabled;
  const remoteProvider: RemoteConfig['provider'] =
    remoteRaw && remoteRaw['provider'] === 'graphiti' ? 'graphiti' : D.provider;
  const remoteEndpoint =
    remoteRaw && typeof remoteRaw['endpoint'] === 'string'
      ? remoteRaw['endpoint']
      : D.endpoint;
  const groupIdPrefix =
    remoteRaw && typeof remoteRaw['group_id_prefix'] === 'string'
      ? remoteRaw['group_id_prefix']
      : D.groupIdPrefix;
  const pushOnGenerate =
    remoteRaw && typeof remoteRaw['push_on_generate'] === 'boolean'
      ? remoteRaw['push_on_generate']
      : D.pushOnGenerate;

  const includeRaw = toRecord(remoteRaw?.['include'] ?? null);
  const includeMemories =
    includeRaw && typeof includeRaw['memories'] === 'boolean'
      ? includeRaw['memories']
      : D.include.memories;
  const includeSummaries =
    includeRaw && typeof includeRaw['summaries'] === 'boolean'
      ? includeRaw['summaries']
      : D.include.summaries;
  const includeImpact =
    includeRaw && typeof includeRaw['impact_analyses'] === 'boolean'
      ? includeRaw['impact_analyses']
      : D.include.impactAnalyses;

  const authRaw = toRecord(remoteRaw?.['auth'] ?? null);
  const authType: RemoteConfig['auth']['type'] =
    authRaw && authRaw['type'] === 'bearer' ? 'bearer' : D.auth.type;
  const tokenEnv =
    authRaw && typeof authRaw['token_env'] === 'string'
      ? authRaw['token_env']
      : D.auth.tokenEnv;

  return {
    indexer: { extensions, skipDirs },
    deadCode: { excludeAnnotations, replaceAnnotations, excludePatterns },
    summaries: { model },
    memory: { enabled: memoryEnabled, path: memoryPath, autoOnboard },
    remote: {
      enabled: remoteEnabled,
      provider: remoteProvider,
      endpoint: remoteEndpoint,
      groupIdPrefix,
      pushOnGenerate,
      include: { memories: includeMemories, summaries: includeSummaries, impactAnalyses: includeImpact },
      auth: { type: authType, tokenEnv },
    },
  };
}
