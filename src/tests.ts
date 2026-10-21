import { existsSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const ROOT_MARKERS = [".git", "package.json", "pyproject.toml", "Cargo.toml", "go.mod", "Gemfile", "pom.xml", "build.gradle", "deno.json"];

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", "target", "vendor", ".venv", "venv", "__pycache__", ".next", ".svelte-kit", ".wrangler", ".turbo", "coverage"]);

const TEST_DIRS = new Set(["test", "tests", "__tests__", "spec", "specs", "e2e"]);

const TEST_FILE = /(^test_.+\.py$)|(_test\.(py|go|rb|exs?)$)|(\.(test|spec)\.[cm]?[jt]sx?$)|(_spec\.rb$)|(Tests?\.(swift|kt|java|cs)$)/u;

const MAX_DEPTH = 6;
const MAX_ENTRIES = 20_000;
const CACHE_MS = 60_000;

export const isTestPath = (path: string): boolean => {
  const parts = path.split(/[\\/]/u);
  const name = parts.at(-1) ?? "";

  return TEST_FILE.test(name) || parts.slice(0, -1).some((part) => TEST_DIRS.has(part));
};

export const projectRootOf = (file: string): string | null => {
  let dir = dirname(file);

  for (;;) {
    if (ROOT_MARKERS.some((marker) => existsSync(join(dir, marker)))) return dir;
    const parent = dirname(dir);

    if (parent === dir) return null;
    dir = parent;
  }
};

export const containsTests = (root: string): boolean => {
  const queue: Array<{ readonly dir: string; readonly depth: number }> = [{ dir: root, depth: 0 }];
  let seen = 0;

  while (queue.length > 0) {
    const next = queue.shift();

    if (!next) break;
    let entries;

    try {
      entries = readdirSync(next.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (++seen > MAX_ENTRIES) return true;

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;

        if (TEST_DIRS.has(entry.name)) return true;

        if (next.depth < MAX_DEPTH) queue.push({ dir: join(next.dir, entry.name), depth: next.depth + 1 });
      } else if (TEST_FILE.test(entry.name)) {
        return true;
      }
    }
  }

  return false;
};

export type TestScan = (path: string, cwd: string) => boolean;

export const cachedTestScan = (scan: (root: string) => boolean = containsTests, now: () => number = Date.now): TestScan => {
  const cache = new Map<string, { readonly hasTests: boolean; readonly at: number }>();

  return (path, cwd) => {
    const file = isAbsolute(path) ? path : resolve(cwd, path);

    if (isTestPath(file)) return true;
    const root = projectRootOf(file) ?? dirname(file);
    const hit = cache.get(root);

    if (hit && now() - hit.at < CACHE_MS) return hit.hasTests;
    const hasTests = scan(root);
    cache.set(root, { hasTests, at: now() });

    return hasTests;
  };
};
