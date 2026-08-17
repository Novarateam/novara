import { replaceLocalEnvEntries } from "./local-connection-config.ts";

// Direct Metricool REST API configuration. This is deliberately separate from the Metricool MCP
// connection used by Hermes (METRICOOL_API_KEY / METRICOOL_MCP_URL), which this module never reads.
const METRICOOL_API_BASE_URL = "https://app.metricool.com/api";

// Known Novara brand from Novara/Integrations/Metricool.md (brand label novarateam).
export const DEFAULT_METRICOOL_BLOG_ID = "6694539";

export type MetricoolConnectionResult = {
  configured: boolean;
  userId: string;
  blogId: string;
  test: "untested" | "successful" | "failed";
  httpStatus?: number;
  reason?: string;
};

const REASON_BY_STATUS: Record<number, string> = {
  400: "Invalid request: check the user ID and blog ID.",
  401: "Authentication failed: Metricool rejected the API key.",
  403: "API key is not authorized (Metricool API access requires an Advanced or Custom plan).",
  404: "Not found: the user ID or blog ID does not exist on this account.",
  429: "Rate limit exceeded.",
};

async function describeFailure(response: Response, apiKey: string, fallback: string): Promise<string> {
  let detail = "";
  try {
    const body = await response.text();
    try {
      const parsed = JSON.parse(body) as { message?: string; error?: string; detail?: string };
      detail = parsed.message ?? parsed.error ?? parsed.detail ?? "";
    } catch {
      detail = body;
    }
  } catch {
    detail = "";
  }
  const safeDetail = detail.replaceAll(apiKey, "<redacted>").replace(/\s+/g, " ").trim().slice(0, 160);
  const base = REASON_BY_STATUS[response.status] ?? fallback;
  return safeDetail ? `${base} (${safeDetail})` : base;
}

/** Never returns the API key. Only the non-secret identifiers and a configured flag. */
export function readMetricoolConnectionStatus(env: NodeJS.ProcessEnv = process.env): MetricoolConnectionResult {
  const userId = env.METRICOOL_USER_ID?.trim() ?? "";
  const blogId = env.METRICOOL_BLOG_ID?.trim() ?? "";
  return {
    configured: Boolean(env.METRICOOL_USER_TOKEN?.trim() && userId && blogId),
    userId,
    blogId: blogId || DEFAULT_METRICOOL_BLOG_ID,
    test: "untested",
  };
}

export function saveMetricoolConnection(envPath: string, apiKey: string, userId: string, blogId: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!apiKey.trim() || !userId.trim() || !blogId.trim()) throw new Error("Metricool API key, user ID, and blog ID are required.");
  if (!/^\d+$/.test(blogId.trim())) throw new Error("Metricool blog ID must be numeric.");
  replaceLocalEnvEntries(envPath, { METRICOOL_USER_TOKEN: apiKey.trim(), METRICOOL_USER_ID: userId.trim(), METRICOOL_BLOG_ID: blogId.trim() }, env);
}

/** Read-only authentication check against the brands endpoint. Never publishes, schedules, or edits. */
export async function testMetricoolConnection(env: NodeJS.ProcessEnv = process.env, requester: typeof fetch = fetch): Promise<MetricoolConnectionResult> {
  const apiKey = env.METRICOOL_USER_TOKEN?.trim();
  const userId = env.METRICOOL_USER_ID?.trim() ?? "";
  const blogId = env.METRICOOL_BLOG_ID?.trim() ?? "";
  if (!apiKey || !userId || !blogId) return { configured: false, userId, blogId: blogId || DEFAULT_METRICOOL_BLOG_ID, test: "untested" };

  const url = `${METRICOOL_API_BASE_URL}/v2/settings/brands?userId=${encodeURIComponent(userId)}&blogId=${encodeURIComponent(blogId)}`;
  try {
    const response = await requester(url, { headers: { "X-Mc-Auth": apiKey, Accept: "application/json" } });
    if (!response.ok) {
      return { configured: true, userId, blogId, test: "failed", httpStatus: response.status, reason: await describeFailure(response, apiKey, "Metricool rejected the request.") };
    }

    const brands = await readBrandIds(response);
    if (brands.length && !brands.includes(blogId)) {
      return { configured: true, userId, blogId, test: "failed", httpStatus: response.status, reason: `Authentication succeeded but blog ID ${blogId} is not available on this account.` };
    }
    return { configured: true, userId, blogId, test: "successful", httpStatus: response.status, reason: "API authentication: OK." };
  } catch {
    return { configured: true, userId, blogId, test: "failed", reason: "Metricool could not be reached from this machine." };
  }
}

async function readBrandIds(response: Response): Promise<string[]> {
  try {
    const payload = await response.json() as { data?: unknown };
    const entries = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
    return entries.flatMap((entry) => {
      const brand = entry as { id?: unknown; blogId?: unknown };
      const id = brand?.id ?? brand?.blogId;
      return typeof id === "number" || typeof id === "string" ? [String(id)] : [];
    });
  } catch {
    return [];
  }
}
