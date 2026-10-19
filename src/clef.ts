import { Type } from "typebox";
import { Value } from "typebox/value";

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<Pick<Response, "json" | "status">>;

export type ClefConfig = { readonly accountId: string; readonly token: string; readonly model: string };

export type NoulQuestion = { readonly type: "noul"; readonly instructions: string };

export type Probabilities = Readonly<Record<string, number>>;

const Reply = Type.Object({
  success: Type.Boolean(),
  result: Type.Optional(Type.Union([Type.Null(), Type.Object({ answers: Type.Record(Type.String(), Type.Object({ noul: Type.Optional(Type.Number()) })) })])),
  errors: Type.Optional(Type.Array(Type.Object({ code: Type.Optional(Type.Number()), message: Type.Optional(Type.String()) }))),
});

const RETRIES = 4;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const askClef = async (fetcher: Fetch, config: ClefConfig, state: string, questions: Readonly<Record<string, NoulQuestion>>): Promise<Probabilities> => {
  const url = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run/${config.model}`;

  for (let attempt = 0; ; attempt++) {
    const response = await fetcher(url, {
      method: "POST",
      headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
      body: JSON.stringify({ state, questions }),
    });

    const reply = Value.Parse(Reply, await response.json());

    if (reply.success && reply.result) return Object.fromEntries(Object.entries(reply.result.answers).map(([id, answer]) => [id, answer.noul ?? 0]));

    if (response.status === 401 || response.status === 403 || attempt >= RETRIES) throw new Error(`clef call failed (${response.status}): ${JSON.stringify(reply.errors)}`);
    await pause(250 * 2 ** attempt);
  }
};
