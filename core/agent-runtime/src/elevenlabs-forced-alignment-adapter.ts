const DEFAULT_BASE_URL = "https://api.elevenlabs.io";
const REQUEST_TIMEOUT_MS = 30000;

export interface ElevenLabsForcedAlignmentConfig {
  apiKey: string;
}

export interface ElevenLabsForcedAlignmentResponse {
  characters: Array<{ text: string; start: number; end: number }>;
  words: Array<{ text: string; start: number; end: number; loss: number }>;
  loss: number;
}

export type ElevenLabsForcedAlignmentOutcome =
  | { status: "succeeded"; alignment: ElevenLabsForcedAlignmentResponse }
  | { status: "failed" | "unknown-result"; code: string; reason: string };

export interface ElevenLabsForcedAlignmentRequester {
  (request: { method: "POST"; url: string; headers: Record<string, string>; body: FormData }): Promise<
    | { kind: "response"; status: number; bytes: Uint8Array }
    | { kind: "transport-error"; code: string; reason: string }
  >;
}

export function readElevenLabsForcedAlignmentConfig(env: NodeJS.ProcessEnv = process.env): ElevenLabsForcedAlignmentConfig | null {
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  return apiKey ? { apiKey } : null;
}

async function defaultRequester(request: { method: "POST"; url: string; headers: Record<string, string>; body: FormData }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body, signal: controller.signal });
    return { kind: "response" as const, status: response.status, bytes: new Uint8Array(await response.arrayBuffer()) };
  } catch {
    return { kind: "transport-error" as const, code: "request-unknown", reason: "ElevenLabs forced alignment outcome is unknown because the connection or timeout failed." };
  } finally {
    clearTimeout(timer);
  }
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseAlignment(bytes: Uint8Array): ElevenLabsForcedAlignmentResponse | null {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.characters) || !Array.isArray(candidate.words) || !isFiniteNonNegative(candidate.loss)) return null;
  const characters = candidate.characters.map((item) => {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    return typeof record.text === "string" && isFiniteNonNegative(record.start) && isFiniteNonNegative(record.end) && record.end >= record.start
      ? { text: record.text, start: record.start, end: record.end } : null;
  });
  const words = candidate.words.map((item) => {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    return typeof record.text === "string" && isFiniteNonNegative(record.start) && isFiniteNonNegative(record.end) && record.end >= record.start && isFiniteNonNegative(record.loss)
      ? { text: record.text, start: record.start, end: record.end, loss: record.loss } : null;
  });
  return characters.every(Boolean) && words.every(Boolean)
    ? { characters: characters as ElevenLabsForcedAlignmentResponse["characters"], words: words as ElevenLabsForcedAlignmentResponse["words"], loss: candidate.loss }
    : null;
}

export class ElevenLabsForcedAlignmentAdapter {
  private readonly env: NodeJS.ProcessEnv;
  private readonly requester: ElevenLabsForcedAlignmentRequester;

  constructor(options: { env?: NodeJS.ProcessEnv; requester?: ElevenLabsForcedAlignmentRequester } = {}) {
    this.env = options.env ?? process.env;
    this.requester = options.requester ?? defaultRequester;
  }

  isConfigured(): boolean { return readElevenLabsForcedAlignmentConfig(this.env) !== null; }

  async align(bytes: Uint8Array, filename: string, text: string): Promise<ElevenLabsForcedAlignmentOutcome> {
    const config = readElevenLabsForcedAlignmentConfig(this.env);
    if (!config) return { status: "failed", code: "not-configured", reason: "ElevenLabs forced alignment requires ELEVENLABS_API_KEY." };
    if (bytes.byteLength === 0 || !text.trim()) return { status: "failed", code: "invalid-input", reason: "Audio bytes and alignment text must be non-empty." };
    const body = new FormData();
    body.append("file", new Blob([bytes], { type: "audio/mpeg" }), filename);
    body.append("text", text);
    const result = await this.requester({ method: "POST", url: `${DEFAULT_BASE_URL}/v1/forced-alignment`, headers: { "xi-api-key": config.apiKey }, body });
    if (result.kind === "transport-error") return { status: "unknown-result", code: result.code, reason: result.reason };
    if (result.status < 200 || result.status >= 300) return { status: "failed", code: `http-${result.status}`, reason: "ElevenLabs definitively rejected the forced alignment request." };
    const alignment = parseAlignment(result.bytes);
    return alignment ? { status: "succeeded", alignment } : { status: "unknown-result", code: "malformed-response", reason: "ElevenLabs returned a successful response without a valid forced alignment schema." };
  }
}

export const elevenLabsForcedAlignmentContract = { method: "POST" as const, path: "/v1/forced-alignment", multipartFields: ["file", "text"], authenticationHeader: "xi-api-key" };