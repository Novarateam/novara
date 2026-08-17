// Server-side Metricool integration boundary. This module ONLY checks configuration and
// basic connectivity/authentication readiness against the real, already-documented Metricool
// integration endpoint (Novara/Integrations/Metricool.md: "MCP connection: https://ai.metricool.com/mcp").
// It never publishes, schedules, or posts anything - no publishing action exists in this
// module. The API key is read from the environment at call time and is never returned,
// logged, or persisted by this module.
//
// Note on scope: the exact Metricool MCP request/response protocol is not independently
// verified in this repository (no working credential is configured in this environment).
// Rather than guess a JSON-RPC/MCP handshake body, the default connector performs a plain
// authenticated HTTP reachability check against the documented URL. This intentionally
// under-claims certainty: it can prove "unreachable/unauthorized" reliably, but a 2xx response
// is only a coarse signal, not full protocol validation. Real verification requires a real
// credential, which must be supplied via environment configuration before this can be trusted.
const DEFAULT_MCP_URL = "https://ai.metricool.com/mcp";
const REQUEST_TIMEOUT_MS = 8000;

export type MetricoolReadinessState = "not-configured" | "unavailable" | "ready";

export interface MetricoolReadiness {
  state: MetricoolReadinessState;
  reason: string;
}

export interface MetricoolConfig {
  mcpUrl: string;
  apiKey: string;
}

/** Reads configuration from the environment only. Never guesses or invents a credential. */
export function readMetricoolConfig(env: NodeJS.ProcessEnv = process.env): MetricoolConfig | null {
  const apiKey = env.METRICOOL_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }
  const mcpUrl = env.METRICOOL_MCP_URL?.trim() || DEFAULT_MCP_URL;
  return { mcpUrl, apiKey };
}

export type MetricoolConnectionOutcome = { ok: true } | { ok: false };

export type MetricoolConnector = (config: MetricoolConfig) => Promise<MetricoolConnectionOutcome>;

/** Plain authenticated HTTP reachability check. Read-only; makes no mutating/publishing call. */
const defaultConnector: MetricoolConnector = async (config) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(config.mcpUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: controller.signal,
    });
    return { ok: response.ok };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
};

export interface CheckMetricoolReadinessOptions {
  env?: NodeJS.ProcessEnv;
  connector?: MetricoolConnector;
}

/**
 * Determines Metricool readiness without ever exposing the configured credential.
 * Never mutates Runtime state, never creates a PublishingQueueEntry, and never
 * modifies a proposal or Content Review decision.
 */
export async function checkMetricoolReadiness(options: CheckMetricoolReadinessOptions = {}): Promise<MetricoolReadiness> {
  const config = readMetricoolConfig(options.env ?? process.env);
  if (!config) {
    return { state: "not-configured", reason: "Metricool is not configured (METRICOOL_API_KEY is missing)." };
  }

  const connector = options.connector ?? defaultConnector;
  const outcome = await connector(config);
  if (!outcome.ok) {
    return { state: "unavailable", reason: "Metricool connection or authentication could not be verified." };
  }
  return { state: "ready", reason: "Metricool connection was verified." };
}
