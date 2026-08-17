import type { PublishingProviderResult } from "./types.ts";

const METRICOOL_API_BASE_URL = "https://app.metricool.com/api";
const REQUEST_TIMEOUT_MS = 30000;

export interface MetricoolPublishingConfig {
  userToken: string;
  userId: string;
  blogId: number;
}

export type MetricoolPublishingReadiness =
  | { status: "ready" }
  | { status: "not-configured"; reason: string }
  | { status: "unavailable"; reason: string };

export interface MetricoolScheduledPostResponse {
  data?: {
    id?: number;
    uuid?: string;
    publicationDate?: { dateTime?: string; timezone?: string };
    creationDate?: { dateTime?: string; timezone?: string };
    providers?: PublishingProviderResult[];
  };
}

export type MetricoolPublishOutcome =
  | { status: "published"; response: MetricoolScheduledPostResponse }
  | { status: "failed"; code: string; reason: string }
  | { status: "unknown-result"; code: string; reason: string };

export interface MetricoolPublishingRequester {
  (request: {
    method: "POST";
    url: string;
    headers: Record<string, string>;
    body: string;
  }): Promise<{ kind: "response"; status: number; body: unknown } | { kind: "transport-error"; code: string; reason: string }>;
}

export interface MetricoolPublishingReader {
  (request: { method: "GET"; url: string; headers: Record<string, string> }): Promise<{ status: number } | { status: "transport-error" }>;
}

export function readMetricoolPublishingConfig(env: NodeJS.ProcessEnv = process.env): MetricoolPublishingConfig | null {
  const userToken = env.METRICOOL_USER_TOKEN?.trim();
  const userId = env.METRICOOL_USER_ID?.trim();
  const blogIdValue = env.METRICOOL_BLOG_ID?.trim();
  const blogId = Number(blogIdValue);
  if (!userToken || !userId || !blogIdValue || !Number.isInteger(blogId) || blogId <= 0) {
    return null;
  }
  return { userToken, userId, blogId };
}

function authHeaders(config: MetricoolPublishingConfig): Record<string, string> {
  return { "X-Mc-Auth": config.userToken, Accept: "application/json" };
}

async function defaultReader(request: { method: "GET"; url: string; headers: Record<string, string> }): Promise<{ status: number } | { status: "transport-error" }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(request.url, { method: request.method, headers: request.headers, signal: controller.signal });
    return { status: response.status };
  } catch {
    return { status: "transport-error" };
  } finally {
    clearTimeout(timer);
  }
}

async function defaultRequester(request: { method: "POST"; url: string; headers: Record<string, string>; body: string }): Promise<{ kind: "response"; status: number; body: unknown } | { kind: "transport-error"; code: string; reason: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: { ...request.headers, "Content-Type": "application/json" },
      body: request.body,
      signal: controller.signal,
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { kind: "transport-error", code: "unreadable-response", reason: "Metricool returned an unreadable response; the external result is unknown." };
    }
    return { kind: "response", status: response.status, body };
  } catch {
    return { kind: "transport-error", code: "request-unknown", reason: "Metricool request outcome is unknown because the connection or timeout failed." };
  } finally {
    clearTimeout(timer);
  }
}

export class MetricoolPublishingAdapter {
  private readonly env: NodeJS.ProcessEnv;
  private readonly requester: MetricoolPublishingRequester;
  private readonly reader: MetricoolPublishingReader;

  constructor(options: { env?: NodeJS.ProcessEnv; requester?: MetricoolPublishingRequester; reader?: MetricoolPublishingReader } = {}) {
    this.env = options.env ?? process.env;
    this.requester = options.requester ?? defaultRequester;
    this.reader = options.reader ?? defaultReader;
  }

  async checkReadiness(): Promise<MetricoolPublishingReadiness> {
    const config = readMetricoolPublishingConfig(this.env);
    if (!config) {
      return { status: "not-configured", reason: "Metricool publishing requires METRICOOL_USER_TOKEN, METRICOOL_USER_ID, and a positive METRICOOL_BLOG_ID." };
    }
    const url = `${METRICOOL_API_BASE_URL}/v2/settings/brands?userId=${encodeURIComponent(config.userId)}`;
    const result = await this.reader({ method: "GET", url, headers: authHeaders(config) });
    if (result.status === "transport-error" || result.status < 200 || result.status >= 300) {
      return { status: "unavailable", reason: "Metricool publishing credentials or brand access could not be verified." };
    }
    return { status: "ready" };
  }

  async publish(body: Record<string, unknown>): Promise<MetricoolPublishOutcome> {
    const config = readMetricoolPublishingConfig(this.env);
    if (!config) {
      return { status: "failed", code: "not-configured", reason: "Metricool publishing configuration is missing." };
    }
    const url = `${METRICOOL_API_BASE_URL}/v2/scheduler/posts?blogId=${config.blogId}&userId=${encodeURIComponent(config.userId)}`;
    const result = await this.requester({ method: "POST", url, headers: authHeaders(config), body: JSON.stringify(body) });
    if (result.kind === "transport-error") {
      return { status: "unknown-result", code: result.code, reason: result.reason };
    }
    if (result.status < 200 || result.status >= 300) {
      return { status: "failed", code: `http-${result.status}`, reason: "Metricool definitively rejected the scheduling request." };
    }
    if (!result.body || typeof result.body !== "object") {
      return { status: "unknown-result", code: "invalid-response", reason: "Metricool returned an invalid response; the external result is unknown." };
    }
    return { status: "published", response: result.body as MetricoolScheduledPostResponse };
  }
}

export const metricoolPublishingContract = {
  method: "POST" as const,
  path: "/api/v2/scheduler/posts",
  requiredBodyFields: ["providers", "publicationDate", "text"],
  supportedNetwork: "instagram",
};
