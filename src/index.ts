import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type ExtensionAPI, type SessionEntry, type ToolCallEvent, isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { type ClefConfig, askClef } from "./clef.ts";
import { QUESTIONS, type ToolInput, callOf, stateOf, verdictOf } from "./judge.ts";

type Env = Readonly<Record<string, string | undefined>>;

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

export default function writeJudge(pi: ExtensionAPI) {
  const config = configOf(process.env);
  const log = process.env["WRITE_JUDGE_LOG"];
  logLine(log, { event: "loaded", configured: config !== null });

  if (!config) return;

  pi.on("tool_call", async (event, ctx) => {
    const said = lastAssistantText(ctx.sessionManager.getBranch());
    const call = callOf(toolInputOf(event), said);

    if (!call) return undefined;
    const started = Date.now();
    const answers = await askClef(fetch, config, stateOf(call), QUESTIONS);
    const verdict = verdictOf(answers["weakens"] ?? 0);
    logLine(log, { event: "judged", tool: call.tool, path: call.path, verdict: verdict.kind, weakens: verdict.weakens, ms: Date.now() - started });

    return verdict.kind === "block" ? { block: true, reason: verdict.reason } : undefined;
  });
}
