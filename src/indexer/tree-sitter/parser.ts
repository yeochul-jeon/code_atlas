import Parser from 'tree-sitter';
// @ts-ignore — no official type declarations for tree-sitter-java
import Java from 'tree-sitter-java';

export type SupportedLanguage = 'java';

let javaParser: Parser | null = null;

export function getParser(language: SupportedLanguage): Parser {
  if (language === 'java') {
    if (!javaParser) {
      javaParser = new Parser();
      javaParser.setLanguage(Java);
    }
    return javaParser;
  }
  throw new Error(`Language not supported: ${language}`);
}

export function detectLanguage(filePath: string): SupportedLanguage | null {
  if (filePath.endsWith('.java')) return 'java';
  // Kotlin support is not yet enabled. To add it:
  //   1. Import tree-sitter-kotlin
  //   2. Add 'kotlin' to SupportedLanguage
  //   3. Initialize kotlin parser here
  //   4. Uncomment kotlin-extractor.ts usage in indexer.ts
  return null;
}

// tree-sitter 0.21.x Node.js bindings reject strings ≥ 32,768 chars with "Invalid argument".
// For large files, use the streaming callback API instead.
const DIRECT_PARSE_LIMIT = 32767;
const CHUNK_SIZE = 4096;

export function parseFile(filePath: string, source: string): Parser.Tree | null {
  const lang = detectLanguage(filePath);
  if (!lang) return null;

  // Strip UTF-8 BOM and normalize CRLF/CR → LF before feeding tree-sitter native binding.
  const normalized = source
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');

  const p = getParser(lang);

  if (normalized.length <= DIRECT_PARSE_LIMIT) {
    return p.parse(normalized);
  }

  // Streaming callback: return fixed-size chunks so each call stays under the 32K limit.
  return p.parse((index: number) => {
    if (index >= normalized.length) return null;
    return normalized.slice(index, index + CHUNK_SIZE);
  });
}
