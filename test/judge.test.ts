import { describe, expect, it } from "vitest";
import { askClef } from "../src/clef.ts";
import { configOf } from "../src/index.ts";
import { WEAKENS_AT, callOf, stateOf, verdictOf } from "../src/judge.ts";

describe("callOf", () => {
  it("reads edit pairs and write content, and ignores other tools", () => {
    expect(callOf("edit", { path: "a.ts", edits: [{ oldText: "x", newText: "y" }] }, "s")).toEqual({ tool: "edit", path: "a.ts", said: "s", pairs: [["x", "y"]] });
    expect(callOf("write", { path: "b.ts", content: "z" }, "")).toEqual({ tool: "write", path: "b.ts", said: "", pairs: [["", "z"]] });
    expect(callOf("bash", { command: "ls" }, "")).toBeNull();
    expect(callOf("edit", { path: "a.ts", edits: [] }, "")).toBeNull();
  });
});

describe("verdictOf", () => {
  it("blocks at the threshold and allows below it", () => {
    expect(verdictOf(WEAKENS_AT).kind).toBe("block");
    expect(verdictOf(WEAKENS_AT - 0.01).kind).toBe("allow");
  });

  it("tells the agent how to proceed when blocked", () => {
    const verdict = verdictOf(0.9);
    expect(verdict.kind === "block" && verdict.reason).toContain("separate edit");
  });
});

describe("stateOf", () => {
  it("shows the path, what the agent said, and what each change removes and adds", () => {
    const state = stateOf({ tool: "edit", path: "t.test.ts", said: "fix it", pairs: [["expect(a).toBe(1)", ""]] });
    expect(state).toContain("File: t.test.ts");
    expect(state).toContain("Agent said: fix it");
    expect(state).toContain("removes:\nexpect(a).toBe(1)");
  });
});

describe("configOf", () => {
  it("needs account, token and model", () => {
    expect(configOf({ WRITE_JUDGE_ACCOUNT_ID: "a", WRITE_JUDGE_TOKEN: "t" })).toBeNull();
    expect(configOf({ WRITE_JUDGE_ACCOUNT_ID: "a", WRITE_JUDGE_TOKEN: "t", WRITE_JUDGE_MODEL: "m" })).toEqual({ accountId: "a", token: "t", model: "m" });
  });
});

describe("askClef", () => {
  it("retries a failed reply and returns yes-probabilities", async () => {
    let calls = 0;

    const fetcher = async () => ({
      json: async () => (++calls < 2 ? { success: false, errors: [{ code: 3040 }] } : { success: true, result: { answers: { weakens: { noul: 0.8 } } } }),
    });

    expect(await askClef(fetcher, { accountId: "a", token: "t", model: "m" }, "s", {})).toEqual({ weakens: 0.8 });
    expect(calls).toBe(2);
  });
});
