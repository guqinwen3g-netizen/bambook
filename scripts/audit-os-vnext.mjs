#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const OS_VNEXT_FORBIDDEN_VALUE_PATTERNS = [
  { id: 'hex-color', regex: /#[0-9a-fA-F]{3,8}\b/g },
  { id: 'rgba-color', regex: /rgba?\([^)]*\)/g },
  {
    id: 'arbitrary-tailwind',
    regex: /\b(?:rounded|bg|shadow|drop-shadow|text|h|w|min-h|min-w|max-h|max-w|p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|blur|backdrop-blur|duration|tracking|leading|translate-x|translate-y|scale|border)-\[[^\]\s]+\]/g,
  },
  { id: 'inline-pixel-style', regex: /\b(?:width|height|minWidth|minHeight|maxWidth|maxHeight|padding|margin|borderRadius):\s*(?:['"`]\d+px['"`]|\d{2,})/g },
];

const DEFAULT_PATHS = ['App.tsx', 'components', 'styles', 'index.css'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.html']);
const EXEMPT_FILES = new Set([
  'components/ui/osVNext.ts',
  'components/ui/OSPrimitives.tsx',
  'styles/os-vnext.css',
]);

const normalizePath = (path) => path.split(sep).join('/');

const extname = (file) => {
  const index = file.lastIndexOf('.');
  return index >= 0 ? file.slice(index) : '';
};

const collectFiles = (rootDir, paths = DEFAULT_PATHS) => {
  const files = [];
  const visit = (absolutePath) => {
    if (!existsSync(absolutePath)) return;
    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      for (const child of readdirSync(absolutePath)) {
        if (child === 'node_modules' || child === 'dist' || child === 'out') continue;
        visit(resolve(absolutePath, child));
      }
      return;
    }
    if (stat.isFile() && SOURCE_EXTENSIONS.has(extname(absolutePath))) {
      files.push(absolutePath);
    }
  };

  for (const path of paths) visit(resolve(rootDir, path));
  return files;
};

const isInsideBracketedUtility = (line, index) => {
  const open = line.lastIndexOf('[', index);
  if (open === -1) return false;
  const close = line.indexOf(']', open);
  return close !== -1 && close >= index;
};

const fingerprint = (violation) => `${violation.file}|${violation.pattern}|${violation.match}`;

export const createBaseline = (result) => {
  const entries = {};
  for (const violation of result.violations) {
    const key = fingerprint(violation);
    entries[key] = (entries[key] || 0) + 1;
  }
  return {
    version: 1,
    generatedBy: 'scripts/audit-os-vnext.mjs',
    entries,
  };
};

const consumeBaseline = (violations, baseline) => {
  if (!baseline?.entries) return violations;
  const remaining = { ...baseline.entries };
  return violations.filter((violation) => {
    const key = fingerprint(violation);
    if (remaining[key] > 0) {
      remaining[key] -= 1;
      return false;
    }
    return true;
  });
};

export const auditFiles = ({ rootDir = process.cwd(), paths = DEFAULT_PATHS, baseline } = {}) => {
  const root = resolve(rootDir);
  const violations = [];
  for (const file of collectFiles(root, paths)) {
    const relativeFile = normalizePath(relative(root, file));
    if (EXEMPT_FILES.has(relativeFile)) continue;
    const source = readFileSync(file, 'utf8');
    const lines = source.split(/\r?\n/);
    lines.forEach((line, lineIndex) => {
      for (const pattern of OS_VNEXT_FORBIDDEN_VALUE_PATTERNS) {
        pattern.regex.lastIndex = 0;
        let match;
        while ((match = pattern.regex.exec(line)) !== null) {
          if ((pattern.id === 'hex-color' || pattern.id === 'rgba-color') && isInsideBracketedUtility(line, match.index)) {
            continue;
          }
          violations.push({
            file: relativeFile,
            line: lineIndex + 1,
            pattern: pattern.id,
            match: match[0],
          });
        }
      }
    });
  }
  return { violations: consumeBaseline(violations, baseline) };
};

export const formatAuditReport = (result) => {
  if (result.violations.length === 0) return 'OS vNext audit passed.';
  const lines = ['OS vNext audit failed. Move these values into the vNext contract first:'];
  for (const violation of result.violations) {
    lines.push(`- ${violation.file}:${violation.line} [${violation.pattern}] ${violation.match}`);
  }
  return lines.join('\n');
};

const loadBaseline = (path) => {
  if (!path || !existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf8'));
};

const parseArgs = (argv) => {
  const args = {
    rootDir: process.cwd(),
    baselinePath: 'scripts/os-vnext-audit-baseline.json',
    updateBaseline: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') args.rootDir = argv[++index];
    else if (arg === '--baseline') args.baselinePath = argv[++index];
    else if (arg === '--update-baseline') args.updateBaseline = true;
  }
  return args;
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  const baselinePath = resolve(args.rootDir, args.baselinePath);
  const rawResult = auditFiles({ rootDir: args.rootDir });
  if (args.updateBaseline) {
    writeFileSync(baselinePath, `${JSON.stringify(createBaseline(rawResult), null, 2)}\n`);
    console.log(`OS vNext audit baseline updated: ${baselinePath}`);
    return;
  }

  const result = auditFiles({
    rootDir: args.rootDir,
    baseline: loadBaseline(baselinePath),
  });
  console.log(formatAuditReport(result));
  if (result.violations.length > 0) process.exitCode = 1;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
