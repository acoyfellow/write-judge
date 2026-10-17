import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type ClefConfig, askClef } from "./clef.ts";
import { QUESTIONS, callOf, stateOf, verdictOf } from "./judge.ts";

type Env = Readonly<Record<string, string | undefined>>;

export const configOf = (env: Env): ClefConfig | null => {
  const accountId = env["WRITE_JUDGE_ACCOUNT_ID"];
  const token = env["WRITE_JUDGE_TOKEN"];
  const model = env["WRITE_JUDGE_MODEL"];
  return accountId && token && model ? { accountId, token, model } : null;
};

const logLine = (path: string | undefined, entry: Record<string, unknown>) => {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
};

const lastAssistantText = (messages: ReadonlyArray<unknown>): string => {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index] as { role?: string; content?: unknown };
    if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
    return message.content
      .filter((part): part is { type: string; text: string } => typeof part === "object" && part !== null && (part as { type?: string }).type === "text")
      .map((part) => part.text)
      .join(" ");
  }
  return "";
};

export default function writeJudge(pi: ExtensionAPI) {
  const config = configOf(process.env);
  const log = process.env["WRITE_JUDGE_LOG"];
  logLine(log, { event: "loaded", configured: config !== null });
  if (!config) return;

  pi.on("tool_call", async (event, ctx) => {
    const said = lastAssistantText(ctx.sessionManager.getBranch().flatMap((entry) => ("message" in entry ? [entry.message] : [])));
    const call = callOf(event.toolName, event.input as Record<string, unknown>, said);
    if (!call) return undefined;
    const started = Date.now();
    const answers = await askClef(fetch, config, stateOf(call), QUESTIONS);
    const verdict = verdictOf(answers["weakens"] ?? 0);
    logLine(log, { event: "judged", tool: call.tool, path: call.path, verdict: verdict.kind, weakens: verdict.weakens, ms: Date.now() - started });
    return verdict.kind === "block" ? { block: true, reason: verdict.reason } : undefined;
  });
}
