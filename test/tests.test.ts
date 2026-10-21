import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { writeJudge } from "../src/index.ts";
import { cachedTestScan, containsTests, isTestPath, projectRootOf } from "../src/tests.ts";

const project = (files: Readonly<Record<string, string>>): string => {
  const root = mkdtempSync(join(tmpdir(), "write-judge-"));
  writeFileSync(join(root, "package.json"), "{}");

  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), body);
  }

  return root;
};

describe("test detection", () => {
  it("recognizes test files and test folders across languages", () => {
    for (const path of ["a/b.test.ts", "x.spec.jsx", "pkg/foo_test.go", "test_api.py", "lib/x_spec.rb", "Sources/AppTests.swift", "tests/helpers.ts", "__tests__/x.js"]) expect(isTestPath(path), path).toBe(true);

    for (const path of ["src/index.ts", "README.md", "src/testing.ts", "contest.py"]) expect(isTestPath(path), path).toBe(false);
  });

  it("finds the project root and whether it has tests, ignoring node_modules", () => {
    const withTests = project({ "src/a.ts": "", "src/a.test.ts": "" });
    const without = project({ "src/a.ts": "", "node_modules/lib/x.test.js": "" });

    expect(projectRootOf(join(withTests, "src", "a.ts"))).toBe(withTests);
    expect(containsTests(withTests)).toBe(true);
    expect(containsTests(without)).toBe(false);
  });

  it("caches the scan per project root", () => {
    const root = project({ "src/a.ts": "" });
    const scan = vi.fn(() => false);
    const hasTests = cachedTestScan(scan, () => 0);

    hasTests("src/a.ts", root);
    hasTests(join(root, "src", "b.ts"), root);
    expect(scan).toHaveBeenCalledTimes(1);
  });
});

type ToolCallHandler = (event: unknown, ctx: unknown) => Promise<unknown>;

const harness = () => {
  let handler: ToolCallHandler | undefined;
  const pi = { on: (_name: string, fn: ToolCallHandler) => (handler = fn) } as unknown as ExtensionAPI;
  const ctx = (cwd: string) => ({ cwd, sessionManager: { getBranch: () => [] }, ui: { notify: vi.fn() } });

  return { pi, call: (cwd: string, path: string) => handler?.({ type: "tool_call", toolName: "write", toolCallId: "1", input: { path, content: "expect(true).toBe(true)" } }, ctx(cwd)) };
};

describe("write-judge skips projects without tests", () => {
  it("allows the write with no config load and no network call", async () => {
    const root = project({ "src/a.ts": "" });
    const loadConfig = vi.fn(async () => ({ accountId: "a", token: "t", model: "m" }));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { pi, call } = harness();
    writeJudge(pi, loadConfig, async () => undefined);

    expect(await call(root, "src/a.ts")).toBeUndefined();
    expect(loadConfig).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("still judges when the project has tests", async () => {
    const root = project({ "src/a.ts": "", "src/a.test.ts": "" });
    const loadConfig = vi.fn(async () => null);
    const { pi, call } = harness();
    writeJudge(pi, loadConfig, async () => undefined);

    await call(root, "src/a.ts");
    expect(loadConfig).toHaveBeenCalledTimes(1);
  });
});
