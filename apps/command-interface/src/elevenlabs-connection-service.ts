import { replaceLocalEnvEntries } from "./local-connection-config.ts";

export type ElevenLabsConnectionResult = {
  configured: boolean;
  test: "untested" | "successful" | "failed";
  httpStatus?: number;
  reason?: string;
};

const REASON_BY_STATUS: Record<number, string> = {
  401: "Authentication failed: ElevenLabs rejected the API key.",
  403: "API key is not authorized for this request (missing scope or IP restriction).",
  404: "Not found: the configured Voice ID does not exist on this account.",
  422: "Invalid request sent to ElevenLabs.",
  429: "Rate limit or quota exceeded.",
};

// The upstream body can echo request context, so the key is stripped before the reason can reach a client.
async function describeFailure(response: Response, apiKey: string, fallback: string): Promise<string> {
  let detail = "";
  try {
    const parsed = JSON.parse(await response.text()) as { detail?: { message?: string; status?: string } | string };
    detail = typeof parsed.detail === "string" ? parsed.detail : parsed.detail?.message ?? parsed.detail?.status ?? "";
  } catch {
    detail = "";
  }
  const safeDetail = detail.replaceAll(apiKey, "<redacted>").replace(/\s+/g, " ").trim().slice(0, 160);
  const base = REASON_BY_STATUS[response.status] ?? fallback;
  return safeDetail ? `${base} (${safeDetail})` : base;
}

export function readElevenLabsConnectionStatus(env: NodeJS.ProcessEnv = process.env) { return { configured: Boolean(env.ELEVENLABS_API_KEY?.trim() && env.ELEVENLABS_VOICE_ID?.trim()), test: "untested" as const }; }
export function saveElevenLabsConnection(envPath: string, apiKey: string, voiceId: string, modelId: string | undefined, env: NodeJS.ProcessEnv = process.env): void {
  if (!apiKey.trim() || !voiceId.trim()) throw new Error("ElevenLabs API key and voice ID are required.");
  replaceLocalEnvEntries(envPath, { ELEVENLABS_API_KEY: apiKey.trim(), ELEVENLABS_VOICE_ID: voiceId.trim(), ...(modelId?.trim() ? { ELEVENLABS_MODEL_ID: modelId.trim() } : {}) }, env);
}
export async function testElevenLabsConnection(env: NodeJS.ProcessEnv = process.env, requester: typeof fetch = fetch): Promise<ElevenLabsConnectionResult> {
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  const voiceId = env.ELEVENLABS_VOICE_ID?.trim();
  if (!apiKey) return { configured: false, test: "untested" };

  const headers = { "xi-api-key": apiKey };
  try {
    const auth = await requester("https://api.elevenlabs.io/v1/user/subscription", { headers });
    if (!auth.ok) {
      return { configured: Boolean(voiceId), test: "failed", httpStatus: auth.status, reason: await describeFailure(auth, apiKey, "ElevenLabs rejected the authentication request.") };
    }
    if (!voiceId) {
      return { configured: false, test: "failed", httpStatus: auth.status, reason: "Authentication succeeded but no Voice ID is configured." };
    }

    const voice = await requester(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(voiceId)}`, { headers });
    if (!voice.ok) {
      return { configured: true, test: "failed", httpStatus: voice.status, reason: await describeFailure(voice, apiKey, "The configured Voice ID could not be verified.") };
    }
    return { configured: true, test: "successful", httpStatus: 200, reason: "Authentication succeeded and the configured voice is available." };
  } catch {
    return { configured: Boolean(voiceId), test: "failed", reason: "ElevenLabs could not be reached from this machine." };
  }
}