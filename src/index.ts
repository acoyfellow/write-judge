import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ExtensionAPI, type SessionEntry, type ToolCallEvent, isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { type ClefConfig, askClef } from "./clef.ts";
import { QUESTIONS, type ToolInput, callOf, stateOf, verdictOf } from "./judge.ts";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { wranglerAccountId, wranglerToken } from "./wrangler.ts";

type Env = Readonly<Record<string, string | undefined>>;

export type TokenSource = () => Promise<string | undefined>;

export type Judgement = { readonly kind: "judged"; readonly weakens: number } | { readonly kind: "unavailable"; readonly error: string };

export const judgeWithRefresh = async (ask: (token: string) => Promise<number>, token: string, refresh: TokenSource): Promise<{ readonly judgement: Judgement; readonly token: string }> => {
  try {
    return { judgement: { kind: "judged", weakens: await ask(token) }, token };
  } catch (first) {
    const fresh = await refresh();

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

const Defaults = Type.Object({ model: Type.Optional(Type.String()) });

const defaultModel = (): string | undefined => {
  try {
    const path = join(dirname(fileURLToPath(import.meta.url)), "..", "defaults.json");

    return Value.Parse(Defaults, JSON.parse(readFileSync(path, "utf8"))).model;
  } catch {
    return undefined;
  }
};

export type ConfigSource = () => Promise<ClefConfig | null>;

export const resolveConfig = async (env: Env, token: TokenSource, accountId: () => Promise<string | undefined>, model: () => string | undefined): Promise<ClefConfig | null> => {
  const resolved = { WRITE_JUDGE_MODEL: env["WRITE_JUDGE_MODEL"] ?? model(), WRITE_JUDGE_ACCOUNT_ID: env["WRITE_JUDGE_ACCOUNT_ID"] ?? (await accountId()), WRITE_JUDGE_TOKEN: env["WRITE_JUDGE_TOKEN"] ?? (await token()) };

  return configOf(resolved);
};

const SETUP_HINT = "write-judge is installed but not active: run `npx wrangler login` (free Cloudflare account), then /reload.";

export const writeJudge = (pi: ExtensionAPI, loadConfig: ConfigSource, refreshToken: TokenSource) => {
  const log = process.env["WRITE_JUDGE_LOG"];
  let pending: Promise<ClefConfig | null> | undefined;
  let token: string | undefined;
  let warned = false;

  const warnOnce = (message: string, notify: (message: string, kind: "warning") => void) => {
    if (warned) return;
    warned = true;
    notify(message, "warning");
  };

  pi.on("tool_call", async (event, ctx) => {
    const said = lastAssistantText(ctx.sessionManager.getBranch());
    const call = callOf(toolInputOf(event), said);

    if (!call) return undefined;
    pending ??= loadConfig().then((config) => {
      logLine(log, { event: "loaded", configured: config !== null });

      return config;
    });
    const config = await pending;

    if (!config) {
      warnOnce(SETUP_HINT, (message, kind) => ctx.ui.notify(message, kind));

      return undefined;
    }

    const started = Date.now();
    const result = await judgeWithRefresh(async (current) => (await askClef(fetch, { ...config, token: current }, stateOf(call), QUESTIONS))["weakens"] ?? 0, token ?? config.token, refreshToken);
    token = result.token;

    if (result.judgement.kind === "unavailable") {
      logLine(log, { event: "unavailable", tool: call.tool, path: call.path, error: result.judgement.error.slice(0, 300), ms: Date.now() - started });
      warnOnce("write-judge could not reach Clef, so edits are not being checked. Run `npx wrangler login`, then /reload.", (message, kind) => ctx.ui.notify(message, kind));

      return undefined;
    }

    warned = false;
    const verdict = verdictOf(result.judgement.weakens);
    logLine(log, { event: "judged", tool: call.tool, path: call.path, verdict: verdict.kind, weakens: verdict.weakens, ms: Date.now() - started });

    return verdict.kind === "block" ? { block: true, reason: verdict.reason } : undefined;
  });
};

export default function installWriteJudge(pi: ExtensionAPI) {
  writeJudge(pi, () => resolveConfig(process.env, wranglerToken, wranglerAccountId, defaultModel), wranglerToken);
}
