import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type ExtensionAPI, type SessionEntry, type ToolCallEvent, isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { type ClefConfig, askClef } from "./clef.ts";
import { QUESTIONS, type ToolInput, callOf, stateOf, verdictOf } from "./judge.ts";

type Env = Readonly<Record<string, string | undefined>>;

export type TokenSource = () => string | undefined;

export type Judgement = { readonly kind: "judged"; readonly weakens: number } | { readonly kind: "unavailable"; readonly error: string };

export const judgeWithRefresh = async (ask: (token: string) => Promise<number>, token: string, refresh: TokenSource): Promise<{ readonly judgement: Judgement; readonly token: string }> => {
  try {
    return { judgement: { kind: "judged", weakens: await ask(token) }, token };
  } catch (first) {
    const fresh = refresh();

    if (!fresh || fresh === token) return { judgement: { kind: "unavailable", error: String(first) }, token };

    try {
      return { judgement: { kind: "judged", weakens: await ask(fresh) }, token: fresh };
    } catch (second) {
      return { judgement: { kind: "unavailable", error: String(second) }, token: fresh };
    }
  }
};

export const configOf = (env: Env): ClefConfig | null => {
  const accountId = env["WRITE_JUDGE_ACCOUNT_ID"];
  const token = env["WRITE_JUDGE_TOKEN"];
  const model = env["WRITE_JUDGE_MODEL"];

  return accountId && token && model ? { accountId, token, model } : null;
};

type LogEntry = Readonly<Record<string, string | number | boolean | null>>;

const logLine = (path: string | undefined, entry: LogEntry) => {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
};

const lastAssistantText = (entries: ReadonlyArray<SessionEntry>): string => {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];

    if (entry?.type !== "message" || entry.message.role !== "assistant") continue;

    return entry.message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(" ");
  }

  return "";
};

const toolInputOf = (event: ToolCallEvent): ToolInput => {
  if (isToolCallEventType("edit", event)) return { toolName: "edit", input: event.input };

  if (isToolCallEventType("write", event)) return { toolName: "write", input: event.input };

  return { toolName: "other" };
};

export default function writeJudge(pi: ExtensionAPI, refreshToken: TokenSource = () => undefined) {
  const config = configOf(process.env);
  const log = process.env["WRITE_JUDGE_LOG"];
  logLine(log, { event: "loaded", configured: config !== null });

  if (!config) return;
  let token = config.token;
  let warned = false;

  pi.on("tool_call", async (event, ctx) => {
    const said = lastAssistantText(ctx.sessionManager.getBranch());
    const call = callOf(toolInputOf(event), said);

    if (!call) return undefined;
    const started = Date.now();
    const result = await judgeWithRefresh(async (current) => (await askClef(fetch, { ...config, token: current }, stateOf(call), QUESTIONS))["weakens"] ?? 0, token, refreshToken);
    token = result.token;

    if (result.judgement.kind === "unavailable") {
      logLine(log, { event: "unavailable", tool: call.tool, path: call.path, error: result.judgement.error.slice(0, 300), ms: Date.now() - started });

      if (!warned) {
        warned = true;
        ctx.ui.notify("write-judge could not reach Clef, so edits are not being checked. Run `wrangler login`, then /reload.", "warning");
      }

      return undefined;
    }

    warned = false;
    const verdict = verdictOf(result.judgement.weakens);
    logLine(log, { event: "judged", tool: call.tool, path: call.path, verdict: verdict.kind, weakens: verdict.weakens, ms: Date.now() - started });

    return verdict.kind === "block" ? { block: true, reason: verdict.reason } : undefined;
  });
}
