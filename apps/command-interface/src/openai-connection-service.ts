import { replaceLocalEnvEntries } from "./local-connection-config.ts";

export type OpenAiConnectionStatus = { configured: boolean; test: "untested" | "successful" | "failed" };

export function readOpenAiConnectionStatus(env: NodeJS.ProcessEnv = process.env): OpenAiConnectionStatus {
  return { configured: Boolean(env.OPENAI_API_KEY?.trim()), test: "untested" };
}

export function saveOpenAiKey(envPath: string, key: string, env: NodeJS.ProcessEnv = process.env): void {
  const normalized = key.trim();
  if (!normalized) throw new Error("OpenAI API key is required.");
  replaceLocalEnvEntries(envPath, { OPENAI_API_KEY: normalized }, env);
}

export async function testOpenAiConnection(env: NodeJS.ProcessEnv = process.env, requester: typeof fetch = fetch): Promise<OpenAiConnectionStatus> {
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) return { configured: false, test: "untested" };
  try {
    const response = await requester("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` } });
    return { configured: true, test: response.ok ? "successful" : "failed" };
  } catch { return { configured: true, test: "failed" }; }
}