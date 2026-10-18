export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ json(): Promise<unknown> }>;

export type ClefConfig = { readonly accountId: string; readonly token: string; readonly model: string };

type Reply = { success: boolean; result?: { answers: Record<string, { noul?: number }> }; errors?: unknown };

const RETRIES = 4;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const askClef = async (fetcher: Fetch, config: ClefConfig, state: string, questions: Record<string, unknown>) => {
  const url = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run/${config.model}`;

  for (let attempt = 0; ; attempt++) {
    const response = await fetcher(url, {
      method: "POST",
      headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
      body: JSON.stringify({ state, questions }),
    });

    const reply = (await response.json()) as Reply;

    if (reply.success && reply.result) return Object.fromEntries(Object.entries(reply.result.answers).map(([id, answer]) => [id, answer.noul ?? 0]));

    if (attempt >= RETRIES) throw new Error(`clef call failed: ${JSON.stringify(reply.errors)}`);
    await pause(250 * 2 ** attempt);
  }
};
