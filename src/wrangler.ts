import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Type } from "typebox";
import { Value } from "typebox/value";

const run = promisify(execFile);

const Whoami = Type.Object({ accounts: Type.Optional(Type.Array(Type.Object({ id: Type.String() }))) });

const attempt = async (command: string, args: ReadonlyArray<string>): Promise<string | undefined> => {
  try {
    const { stdout } = await run(command, [...args], { timeout: 60_000, encoding: "utf8" });

    return stdout;
  } catch {
    return undefined;
  }
};

const wrangler = async (args: ReadonlyArray<string>): Promise<string | undefined> => (await attempt("wrangler", args)) ?? (await attempt("npx", ["--yes", "wrangler@latest", ...args]));

export const lastLine = (text: string | undefined): string | undefined => text?.trim().split("\n").pop()?.trim() || undefined;

export const firstAccountId = (whoamiJson: string | undefined): string | undefined => {
  if (!whoamiJson) return undefined;

  try {
    return Value.Parse(Whoami, JSON.parse(whoamiJson.slice(whoamiJson.indexOf("{")))).accounts?.[0]?.id;
  } catch {
    return undefined;
  }
};

export const wranglerToken = async (): Promise<string | undefined> => lastLine(await wrangler(["auth", "token"]));

export const wranglerAccountId = async (): Promise<string | undefined> => firstAccountId(await wrangler(["whoami", "--json"]));
