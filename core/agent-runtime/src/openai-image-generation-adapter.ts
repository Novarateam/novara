import type { VisualGenerationAdapter, VisualGenerationOutcome, VisualGenerationRequest } from "./visual-production-service.ts";

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
const DEFAULT_MODEL_ID = "gpt-image-2";

type OpenAIImageSize = "1024x1024" | "1024x1536" | "1536x1024";

export interface OpenAIImageGenerationRequest {
  method: "POST";
  url: string;
  headers: Record<string, string>;
  body: string;
}

export type OpenAIImageGenerationTransportResult =
  | { kind: "response"; status: number; body: unknown }
  | { kind: "transport-error"; code: string; reason: string };

export type OpenAIImageGenerationRequester = (request: OpenAIImageGenerationRequest) => Promise<OpenAIImageGenerationTransportResult>;

export type OpenAIImageGenerationResult =
  | { status: "succeeded"; bytes: Uint8Array; mimeType: "image/png" }
  | { status: "failed"; reason: string }
  | { status: "unknown-result"; reason: string };

export interface OpenAIImageGenerationConfig {
  apiKey: string;
  modelId: string;
}

export function readOpenAIImageGenerationConfig(env: NodeJS.ProcessEnv = process.env): OpenAIImageGenerationConfig | null {
  const apiKey = env.OPENAI_API_KEY?.trim();
  return apiKey ? { apiKey, modelId: env.OPENAI_IMAGE_MODEL_ID?.trim() || DEFAULT_MODEL_ID } : null;
}

export function mapAspectRatioToOpenAIImageSize(aspectRatio: string | undefined): OpenAIImageSize | undefined {
  if (aspectRatio === "9:16") return "1024x1536";
  if (aspectRatio === "1:1") return "1024x1024";
  if (aspectRatio === "16:9") return "1536x1024";
  return undefined;
}

async function defaultRequester(request: OpenAIImageGenerationRequest): Promise<OpenAIImageGenerationTransportResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body, signal: controller.signal });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { kind: "transport-error", code: "unreadable-response", reason: "OpenAI returned an unreadable image response; the result is unknown." };
    }
    return { kind: "response", status: response.status, body };
  } catch {
    return { kind: "transport-error", code: "request-unknown", reason: "OpenAI image generation outcome is unknown because the connection or timeout failed." };
  } finally {
    clearTimeout(timer);
  }
}

function readBase64Image(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const data = (body as Record<string, unknown>).data;
  if (!Array.isArray(data) || !data[0] || typeof data[0] !== "object") return undefined;
  const value = (data[0] as Record<string, unknown>).b64_json;
  return typeof value === "string" && value ? value : undefined;
}

export class OpenAIImageGenerationAdapter {
  private readonly env: NodeJS.ProcessEnv;
  private readonly requester: OpenAIImageGenerationRequester;

  constructor(options: { env?: NodeJS.ProcessEnv; requester?: OpenAIImageGenerationRequester } = {}) {
    this.env = options.env ?? process.env;
    this.requester = options.requester ?? defaultRequester;
  }

  isConfigured(): boolean {
    return readOpenAIImageGenerationConfig(this.env) !== null;
  }

  async generateImage(prompt: string, aspectRatio: string | undefined): Promise<OpenAIImageGenerationResult> {
    const config = readOpenAIImageGenerationConfig(this.env);
    if (!config) return { status: "failed", reason: "OpenAI image generation requires OPENAI_API_KEY." };
    const trimmedPrompt = prompt.trim();
    const size = mapAspectRatioToOpenAIImageSize(aspectRatio);
    if (!trimmedPrompt) return { status: "failed", reason: "Visual scene description must be non-empty." };
    if (!size) return { status: "failed", reason: `Aspect ratio "${aspectRatio ?? "missing"}" cannot be mapped to a verified OpenAI image size.` };

    const result = await this.requester({
      method: "POST",
      url: OPENAI_IMAGES_URL,
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ model: config.modelId, prompt: trimmedPrompt, size }),
    });
    if (result.kind === "transport-error") return { status: "unknown-result", reason: result.reason };
    if (result.status < 200 || result.status >= 300) return { status: "failed", reason: "OpenAI definitively rejected the image generation request." };
    const encoded = readBase64Image(result.body);
    if (!encoded) return { status: "unknown-result", reason: "OpenAI returned no usable base64 image result; the result is unknown." };
    try {
      const bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
      if (bytes.byteLength === 0) return { status: "unknown-result", reason: "OpenAI returned empty image bytes; the result is unknown." };
      return { status: "succeeded", bytes, mimeType: "image/png" };
    } catch {
      return { status: "unknown-result", reason: "OpenAI returned invalid image data; the result is unknown." };
    }
  }
}

export class OpenAIVisualGenerationAdapter implements VisualGenerationAdapter {
  private readonly imageAdapter: OpenAIImageGenerationAdapter;

  constructor(options: ConstructorParameters<typeof OpenAIImageGenerationAdapter>[0] = {}) {
    this.imageAdapter = new OpenAIImageGenerationAdapter(options);
  }

  isConfigured(): boolean {
    return this.imageAdapter.isConfigured();
  }

  async generate(request: VisualGenerationRequest): Promise<VisualGenerationOutcome> {
    if (request.sceneSequence <= 0 || !request.sceneDescription.trim()) {
      return { status: "failed", reason: "A non-empty visual scene and positive scene sequence are required." };
    }
    const result = await this.imageAdapter.generateImage(request.sceneDescription, request.aspectRatio);
    if (result.status !== "succeeded") return result;
    return { status: "succeeded", assets: [{ assetType: "image", bytes: result.bytes, mimeType: result.mimeType }] };
  }
}

export const openAIImageGenerationContract = {
  method: "POST" as const,
  url: OPENAI_IMAGES_URL,
  model: DEFAULT_MODEL_ID,
  requiredBodyFields: ["model", "prompt", "size"],
  authenticationHeader: "Authorization",
  responseField: "data[0].b64_json",
};
