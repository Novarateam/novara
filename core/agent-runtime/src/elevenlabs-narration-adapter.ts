const DEFAULT_BASE_URL = "https://api.elevenlabs.io";
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";
const OUTPUT_FORMAT = "mp3_44100_128";
const REQUEST_TIMEOUT_MS = 30000;

export interface ElevenLabsNarrationConfig {
  apiKey: string;
  voiceId: string;
  modelId: string;
}

export type ElevenLabsNarrationOutcome =
  | { status: "succeeded"; bytes: Uint8Array; mimeType: "audio/mpeg" }
  | { status: "failed"; code: string; reason: string }
  | { status: "unknown-result"; code: string; reason: string };

export interface ElevenLabsNarrationRequester {
  (request: {
    method: "POST";
    url: string;
    headers: Record<string, string>;
    body: string;
  }): Promise<
    | { kind: "response"; status: number; headers: Record<string, string | undefined>; bytes: Uint8Array }
    | { kind: "transport-error"; code: string; reason: string }
  >;
}

export function readElevenLabsNarrationConfig(env: NodeJS.ProcessEnv = process.env): ElevenLabsNarrationConfig | null {
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  const voiceId = env.ELEVENLABS_VOICE_ID?.trim();
  if (!apiKey || !voiceId) return null;
  return {
    apiKey,
    voiceId,
    modelId: env.ELEVENLABS_MODEL_ID?.trim() || DEFAULT_MODEL_ID,
  };
}

async function defaultRequester(request: {
  method: "POST";
  url: string;
  headers: Record<string, string>;
  body: string;
}): Promise<
  | { kind: "response"; status: number; headers: Record<string, string | undefined>; bytes: Uint8Array }
  | { kind: "transport-error"; code: string; reason: string }
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });
    return {
      kind: "response",
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? undefined },
      bytes: new Uint8Array(await response.arrayBuffer()),
    };
  } catch {
    return { kind: "transport-error", code: "request-unknown", reason: "ElevenLabs request outcome is unknown because the connection or timeout failed." };
  } finally {
    clearTimeout(timer);
  }
}

export class ElevenLabsNarrationAdapter {
  private readonly env: NodeJS.ProcessEnv;
  private readonly requester: ElevenLabsNarrationRequester;

  constructor(options: { env?: NodeJS.ProcessEnv; requester?: ElevenLabsNarrationRequester } = {}) {
    this.env = options.env ?? process.env;
    this.requester = options.requester ?? defaultRequester;
  }

  isConfigured(): boolean {
    return readElevenLabsNarrationConfig(this.env) !== null;
  }

  async generate(text: string): Promise<ElevenLabsNarrationOutcome> {
    const config = readElevenLabsNarrationConfig(this.env);
    if (!config) return { status: "failed", code: "not-configured", reason: "ElevenLabs narration requires ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID." };
    const narrationText = text.trim();
    if (!narrationText) return { status: "failed", code: "invalid-text", reason: "Narration text must be non-empty." };

    const url = `${DEFAULT_BASE_URL}/v1/text-to-speech/${encodeURIComponent(config.voiceId)}?output_format=${OUTPUT_FORMAT}`;
    const result = await this.requester({
      method: "POST",
      url,
      headers: { "xi-api-key": config.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text: narrationText, model_id: config.modelId }),
    });
    if (result.kind === "transport-error") return { status: "unknown-result", code: result.code, reason: result.reason };
    if (result.status < 200 || result.status >= 300) return { status: "failed", code: `http-${result.status}`, reason: "ElevenLabs definitively rejected the narration request." };
    if (result.bytes.byteLength === 0) return { status: "unknown-result", code: "empty-response", reason: "ElevenLabs returned an empty audio response; the result is unknown." };
    return { status: "succeeded", bytes: result.bytes, mimeType: "audio/mpeg" };
  }
}

export const elevenLabsNarrationContract = {
  method: "POST" as const,
  path: "/v1/text-to-speech/{voice_id}",
  outputFormat: OUTPUT_FORMAT,
  requiredBodyFields: ["text", "model_id"],
  authenticationHeader: "xi-api-key",
};
