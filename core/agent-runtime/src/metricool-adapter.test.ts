import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkMetricoolReadiness,
  readMetricoolConfig,
  type MetricoolConnector,
} from "./metricool-adapter.ts";

const SECRET_KEY = "metricool-test-secret-should-never-leak-1234567890";

// A. Missing Metricool configuration reports "not configured" and fails closed.
{
  const readiness = await checkMetricoolReadiness({ env: {} });
  assert.equal(readiness.state, "not-configured");
  assert.doesNotMatch(readiness.reason, /metricool-test-secret/);

  assert.equal(readMetricoolConfig({}), null, "missing METRICOOL_API_KEY must never be guessed or defaulted");
}

// B. No secret is returned through the readiness result, in any state.
{
  const okConnector: MetricoolConnector = async () => ({ ok: true });
  const ready = await checkMetricoolReadiness({ env: { METRICOOL_API_KEY: SECRET_KEY }, connector: okConnector });
  assert.equal(ready.state, "ready");
  assert.ok(!JSON.stringify(ready).includes(SECRET_KEY), "the configured API key must never appear in the readiness result");

  const failConnector: MetricoolConnector = async () => ({ ok: false });
  const unavailable = await checkMetricoolReadiness({ env: { METRICOOL_API_KEY: SECRET_KEY }, connector: failConnector });
  assert.equal(unavailable.state, "unavailable");
  assert.ok(!JSON.stringify(unavailable).includes(SECRET_KEY), "the configured API key must never appear in a failure result either");
}

// O. The adapter never reports "ready" unless the connector genuinely reported success.
// This test uses a controlled fake connector (no real Metricool credential exists in this
// environment), clearly distinguished here from a real connection: it proves the *contract*
// (ready only follows a real ok:true outcome), not that Metricool itself is reachable.
{
  const throwingConnector: MetricoolConnector = async () => {
    throw new Error("simulated network failure");
  };
  await assert.rejects(() => checkMetricoolReadiness({ env: { METRICOOL_API_KEY: SECRET_KEY }, connector: throwingConnector }));

  const explicitFailure: MetricoolConnector = async () => ({ ok: false });
  const result = await checkMetricoolReadiness({ env: { METRICOOL_API_KEY: SECRET_KEY }, connector: explicitFailure });
  assert.notEqual(result.state, "ready", "must never report ready when the connector did not report ok:true");
}

// M/K/L (static): no scheduler, retry loop, bulk publishing, or background timer exists in this adapter.
// (A single setTimeout is used only for the request abort/timeout controller, not scheduling.)
{
  const source = readFileSync(new URL("./metricool-adapter.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /setInterval|\bcron\b|\bschedule\b/i, "no scheduler/retry loop may exist in the adapter");
  assert.doesNotMatch(source, /instagram|tiktok|youtube/i, "no direct social platform posting may exist in this phase");
}

console.log("Metricool adapter tests passed.");
