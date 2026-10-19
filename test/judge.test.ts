import { describe, expect, it } from "vitest";
import { askClef } from "../src/clef.ts";
import { configOf, judgeWithRefresh, resolveConfig } from "../src/index.ts";
import { firstAccountId, lastLine } from "../src/wrangler.ts";
import { WEAKENS_AT, callOf, stateOf, verdictOf } from "../src/judge.ts";

describe("callOf", () => {
  it("reads edit pairs and write content, and ignores other tools", () => {
    expect(callOf({ toolName: "edit", input: { path: "a.ts", edits: [{ oldText: "x", newText: "y" }] } }, "s")).toEqual({ tool: "edit", path: "a.ts", said: "s", pairs: [["x", "y"]] });
    expect(callOf({ toolName: "write", input: { path: "b.ts", content: "z" } }, "")).toEqual({ tool: "write", path: "b.ts", said: "", pairs: [["", "z"]] });
    expect(callOf({ toolName: "other" }, "")).toBeNull();
    expect(callOf({ toolName: "edit", input: { path: "a.ts", edits: [] } }, "")).toBeNull();
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
      status: calls < 1 ? 429 : 200,
      json: async () => (++calls < 2 ? { success: false, errors: [{ code: 3040 }] } : { success: true, result: { answers: { weakens: { noul: 0.8 } } } }),
    });

    expect(await askClef(fetcher, { accountId: "a", token: "t", model: "m" }, "s", {})).toEqual({ weakens: 0.8 });
    expect(calls).toBe(2);
  });
});

describe("judgeWithRefresh", () => {
  it("uses the current token when it works", async () => {
    const result = await judgeWithRefresh(async () => 0.9, "old", async () => "new");
    expect(result).toEqual({ judgement: { kind: "judged", weakens: 0.9 }, token: "old" });
  });

  it("refreshes once after a failure and keeps the new token", async () => {

    const failsOnOld = async (token: string) => {
      if (token === "old") throw new Error("401");

      return 0.2;
    };

    const result = await judgeWithRefresh(failsOnOld, "old", async () => "new");
    expect(result).toEqual({ judgement: { kind: "judged", weakens: 0.2 }, token: "new" });
  });

  it("reports unavailable instead of throwing when refresh does not help", async () => {
    const same = await judgeWithRefresh(async () => { throw new Error("401"); }, "old", async () => "old");
    const none = await judgeWithRefresh(async () => { throw new Error("401"); }, "old", async () => undefined);
    const stillBad = await judgeWithRefresh(async () => { throw new Error("401"); }, "old", async () => "new");
    expect([same.judgement.kind, none.judgement.kind, stillBad.judgement.kind]).toEqual(["unavailable", "unavailable", "unavailable"]);
  });
});

describe("askClef on auth errors", () => {
  it("fails at once on 401 instead of retrying", async () => {
    let calls = 0;

    const fetcher = async () => {
      calls++;

      return { status: 401, json: async () => ({ success: false, errors: [{ code: 10000, message: "Authentication error" }] }) };
    };

    await expect(askClef(fetcher, { accountId: "a", token: "t", model: "m" }, "s", { q: { type: "noul", instructions: "q" } })).rejects.toThrow("401");
    expect(calls).toBe(1);
  });
});

describe("zero-config resolution", () => {
  it("prefers env, then wrangler, then the default model", async () => {
    const fromWrangler = await resolveConfig({}, async () => "tok", async () => "acct", () => "model-default");
    const fromEnv = await resolveConfig({ WRITE_JUDGE_TOKEN: "envtok", WRITE_JUDGE_ACCOUNT_ID: "envacct", WRITE_JUDGE_MODEL: "envmodel" }, async () => "tok", async () => "acct", () => "model-default");
    const loggedOut = await resolveConfig({}, async () => undefined, async () => undefined, () => "model-default");
    expect([fromWrangler, fromEnv, loggedOut]).toEqual([{ accountId: "acct", token: "tok", model: "model-default" }, { accountId: "envacct", token: "envtok", model: "envmodel" }, null]);
  });

  it("parses wrangler output", () => {
    expect(lastLine("warning line\n  abc123  \n")).toBe("abc123");
    expect(lastLine("")).toBeUndefined();
    expect(firstAccountId('noise {"accounts":[{"id":"a1","name":"x"},{"id":"a2","name":"y"}]}')).toBe("a1");
    expect(firstAccountId("not json")).toBeUndefined();
  });
});
