import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RecordHumanGovernanceDecisionRequest } from "../../../core/agent-runtime/src/types.ts";
import { routeHermesRequest } from "./hermes-routing.ts";
import { handleTrustReviewCommand } from "./trust-review-command.ts";
import { handleGovernanceDecisionCommand } from "./governance-decision-command.ts";
import { handlePromotionCommand } from "./promotion-command.ts";
import { handleContentReviewReadCommand, handleContentReviewDecisionCommand } from "./content-review-command.ts";
import { handlePublishingQueueReadCommand, handlePublishingQueueEnqueueCommand } from "./publishing-queue-command.ts";
import { handleMetricoolStatusCommand, handleMetricoolPreflightCommand } from "./metricool-command.ts";
import { handleMetricoolPublishingCommand } from "./metricool-publishing-command.ts";
import { handleProductionExecutionCommand } from "./production-execution-command.ts";
import { handleProductionStatusCommand } from "./production-status-command.ts";
import { handleProductionApprovalCommand } from "./production-approval-command.ts";
import { handleProductionBriefCommand } from "./production-brief-command.ts";
import { handleInstitutionalKnowledgeCommand } from "./institutional-knowledge-command.ts";
import { readOpenAiConnectionStatus, saveOpenAiKey, testOpenAiConnection } from "./openai-connection-service.ts";
import { readContentReviewAccessStatus, saveContentReviewAccess } from "./content-review-connection-service.ts";
import { readProductionAccessStatus, saveProductionAccess } from "./production-access-connection-service.ts";
import { readPublishingAccessStatus, savePublishingAccess } from "./publishing-access-connection-service.ts";
import { readElevenLabsConnectionStatus, saveElevenLabsConnection, testElevenLabsConnection } from "./elevenlabs-connection-service.ts";
import { readMetricoolConnectionStatus, saveMetricoolConnection, testMetricoolConnection } from "./metricool-connection-service.ts";
import { configureRevenueCatConnection, readRevenueCatConnectionStatus, testRevenueCatConnection } from "./revenuecat-connection-service.ts";
import { createRuntimeHost, type RuntimeHost } from "./runtime-host.ts";

type MetricoolEvidence = {
  sourceDate: string | null;
  facts: string[];
  interpretation: string;
  status: string;
  unresolvedQuestions: string[];
};

type StrategicDecision = {
  date: string | null;
  source: string;
  externalEvidence: string;
  interpretation: string;
  confidence: string;
  status: string;
  unresolvedQuestions: string;
  ceoDecision: string;
};

const repoRoot = path.resolve(process.cwd());
const envPath = path.resolve(repoRoot, ".env");
const publicRoot = path.resolve(repoRoot, "apps/command-interface/public");
const vaultRoot = path.resolve(repoRoot, "Novara");
const metricoolNotePath = path.resolve(vaultRoot, "Integrations/Metricool.md");
const strategicDecisionPath = path.resolve(vaultRoot, "Strategy/Strategic Decisions.md");
const currentObjectivesPath = path.resolve(vaultRoot, "Strategy/Current Objectives.md");

async function loadEnvFile(filePath: string): Promise<void> {
  const raw = await readIfExists(filePath);
  if (!raw) {
    return;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

async function readIfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function parseBullets(markdown: string, sectionTitle: string): string[] {
  const sectionRegex = new RegExp(`##\\s+${sectionTitle}([\\s\\S]*?)(\\n##\\s+|$)`, "i");
  const section = markdown.match(sectionRegex)?.[1] ?? "";
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());
}

function parseSingleField(markdown: string, label: string): string {
  const regex = new RegExp(`-\\s+${label}:\\s*(.+)$`, "im");
  return markdown.match(regex)?.[1]?.trim() ?? "Unknown";
}

function parseMetricoolEvidence(markdown: string): MetricoolEvidence {
  const sourceLine = markdown
    .split(/\r?\n/)
    .find((line) => line.toLowerCase().includes("retrieved through hermes on"));
  const sourceDate = sourceLine?.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;

  return {
    sourceDate,
    facts: parseBullets(markdown, "Facts"),
    interpretation: (markdown.match(/##\s+Interpretation\s*\n([\s\S]*?)\n##\s+/i)?.[1] ?? "")
      .trim()
      .replace(/\r?\n/g, " "),
    status: (markdown.match(/##\s+Status\s*\n([\s\S]*?)(\n##\s+|$)/i)?.[1] ?? "")
      .trim()
      .replace(/\r?\n/g, " "),
    unresolvedQuestions: parseBullets(markdown, "Unresolved Questions"),
  };
}

function parseStrategicDecision(markdown: string): StrategicDecision {
  return {
    date: parseSingleField(markdown, "Date"),
    source: parseSingleField(markdown, "Source"),
    externalEvidence: parseSingleField(markdown, "External evidence"),
    interpretation: parseSingleField(markdown, "Novara interpretation"),
    confidence: parseSingleField(markdown, "Confidence"),
    status: parseSingleField(markdown, "Status"),
    unresolvedQuestions: parseSingleField(markdown, "Unresolved questions"),
    ceoDecision: parseSingleField(markdown, "CEO decision"),
  };
}

function countConnectedNetworks(facts: string[]): number | null {
  const networksLine = facts.find((fact) => fact.toLowerCase().startsWith("networks connected:"));
  if (!networksLine) {
    return null;
  }

  const list = networksLine.split(":", 2)[1]?.trim();
  if (!list) {
    return null;
  }

  return list.split(/\s*,\s*/).filter(Boolean).length || null;
}

async function countVaultMarkdownFiles(root: string): Promise<number> {
  let count = 0;

  async function walk(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".obsidian") {
        continue;
      }

      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        count += 1;
      }
    }
  }

  await walk(root);
  return count;
}

async function getSnapshot(runtimeHost: RuntimeHost) {
  const metricoolMarkdown = await readIfExists(metricoolNotePath);
  const strategicMarkdown = await readIfExists(strategicDecisionPath);
  const objectiveMarkdown = await readIfExists(currentObjectivesPath);

  const metricool = parseMetricoolEvidence(metricoolMarkdown);
  const strategicDecision = parseStrategicDecision(strategicMarkdown);
  const objective =
    parseBullets(objectiveMarkdown, "Current Strategic Focus")[0] ??
    "Build a durable social attention engine for Novara.";

  const runtime = runtimeHost.getRuntime();
  const companyBrief = runtime.getCompanyBrief();
  const agents = runtime.listAgents();
  const vaultDocCount = await countVaultMarkdownFiles(vaultRoot);
  const state = companyBrief.state;
  const connectedNetworks = countConnectedNetworks(metricool.facts);
  const commandInterface = {
    companyPulse: {
      revenue: null,
      subscribers: null,
      subscribersTrend: null,
      clicks: null,
      clicksTrend: null,
      views: null,
      viewsTrend: null,
      channelsActive: connectedNetworks,
      agentsActive: agents.length,
    },
    currentNext: {
      currently: state.activeWork[0] ?? null,
      next: state.pendingDecisions[0] ?? null,
    },
    monthlyGoal: {
      label: "TURNOVER",
      current: null,
      target: null,
      remaining: null,
      progress: null,
      pace: null,
      configured: false,
    },
    autonomy: {
      status: "Operational",
      level: "2",
      percent: 42,
    },
    agentCount: agents.length,
    agentNames: agents.map((agent) => agent.name ?? agent.id ?? "Agent"),
  };

  return {
    generatedAt: new Date().toISOString(),
    objective,
    companyBrief,
    agents,
    metricool,
    strategicDecision,
    knowledge: {
      vaultPath: vaultRoot,
      markdownDocuments: vaultDocCount,
    },
    commandInterface,
  };
}

function respondJson(res: any, statusCode: number, body: unknown) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body, null, 2));
}

function respondText(res: any, statusCode: number, text: string, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, { "Content-Type": contentType });
  res.end(text);
}

async function readJsonBody(req: any, maxBytes = 32 * 1024): Promise<any> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      throw new Error("Payload too large");
    }
    chunks.push(buf);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

function hasElevenLabsKey(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY?.trim());
}

async function synthesizeWithElevenLabs(text: string): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("VOICE_NOT_CONNECTED");
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim() || "EXAVITQu4vr4xnSDxMaL";
  const modelId = process.env.ELEVENLABS_MODEL_ID?.trim() || "eleven_multilingual_v2";

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      Accept: "audio/mpeg",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability: 0.35,
        similarity_boost: 0.7,
      },
    }),
  });

  if (!response.ok) {
    throw new Error("VOICE_UPSTREAM_ERROR");
  }

  const audio = await response.arrayBuffer();
  return Buffer.from(audio);
}

async function serveStatic(res: any, pathname: string) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const fullPath = path.resolve(publicRoot, `.${safePath}`);

  if (!fullPath.startsWith(publicRoot)) {
    respondText(res, 403, "Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const typeByExt: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
    };
    respondText(res, 200, content.toString("utf8"), typeByExt[ext] ?? "application/octet-stream");
  } catch {
    respondText(res, 404, "Not found");
  }
}

function buildHermesReply(question: string, snapshot: Awaited<ReturnType<typeof getSnapshot>>) {
  const q = question.toLowerCase();
  const state = snapshot.companyBrief.state;
  const unresolved = snapshot.metricool.unresolvedQuestions;

  if (q.includes("attention")) {
    return {
      answer: `Top attention items: ${state.pendingDecisions.slice(0, 3).join("; ") || "No pending decisions"}.`,
    };
  }

  if (q.includes("what changed")) {
    return {
      answer: `Latest external evidence update is from Metricool (${snapshot.metricool.sourceDate ?? "unknown date"}). Social opportunity remains proposed because evidence is insufficient.`,
    };
  }

  if (q.includes("why") && q.includes("social")) {
    return {
      answer: `Social is orange because Metricool shows zero current activity baseline and no scheduled pipeline. Missing: ${unresolved.join("; ")}.`,
    };
  }

  if (q.includes("decisions")) {
    return {
      answer: `Pending decisions: ${state.pendingDecisions.join("; ") || "None"}. CEO authority is required for strategic advancement.`,
    };
  }

  if (q.includes("opportunit")) {
    return {
      answer: `Current top opportunity: ${state.opportunities[0] ?? "No opportunity detected"}. Status remains proposed, not verified.`,
    };
  }

  if (q.includes("risk")) {
    return {
      answer: `Current risks: ${state.risks.join("; ") || "No risk signals"}.`,
    };
  }

  if (q.includes("brief")) {
    return {
      answer: `Briefing: ${snapshot.companyBrief.summary}. Strategic decision status: ${snapshot.strategicDecision.status}.`,
    };
  }

  return {
    answer:
      "Hermes can summarize attention, changes, social evidence status, pending decisions, opportunities, and risks using current Novara runtime and Obsidian evidence.",
  };
}

export function createCommandInterfaceServer(runtimeHost: RuntimeHost = createRuntimeHost()) {
  return createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/api/voice/status") {
    respondJson(res, 200, {
      provider: "elevenlabs",
      connected: hasElevenLabsKey(),
    });
    return;
  }

  if (url.pathname === "/api/voice/speak") {
    if (req.method !== "POST") {
      respondJson(res, 405, { error: "Method not allowed" });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const text = String(body?.text ?? "").trim();
      if (!text) {
        respondJson(res, 400, { error: "Missing text" });
        return;
      }

      if (!hasElevenLabsKey()) {
        respondJson(res, 503, { error: "Voice provider not connected" });
        return;
      }

      const audio = await synthesizeWithElevenLabs(text.slice(0, 1200));
      res.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "Content-Length": String(audio.length),
      });
      res.end(audio);
    } catch {
      respondJson(res, 502, { error: "Voice synthesis failed" });
    }
    return;
  }

  if (url.pathname === "/api/runtime/health") {
    if (req.method !== "GET") {
      respondJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const health = runtimeHost.getHealth();
    respondJson(res, health.initialized ? 200 : 503, health);
    return;
  }

  if (url.pathname === "/api/command-interface") {
    if (req.method !== "GET") {
      respondJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      respondJson(res, 200, await getSnapshot(runtimeHost));
    } catch (error) {
      respondJson(res, 503, { error: (error as Error).message });
    }
    return;
  }

  if (url.pathname === "/api/trust-review") {
    if (req.method !== "GET") {
      respondJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const response = handleTrustReviewCommand({
      operation: url.searchParams.get("operation") as "listTrustReports" | "getTrustReport" | "getAgentTrustReview" | undefined,
      reportId: url.searchParams.get("reportId") ?? undefined,
      agentId: url.searchParams.get("agentId") ?? undefined,
    });
    respondJson(res, response.status === "invalid-request" ? 400 : 200, response);
    return;
  }

  if (url.pathname === "/api/governance-decision") {
    if (req.method !== "POST") {
      respondJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      const body = await readJsonBody(req);
      const response = handleGovernanceDecisionCommand({
        decisionId: typeof body?.decisionId === "string" ? body.decisionId : undefined,
        agentId: typeof body?.agentId === "string" ? body.agentId : "",
        trustReportId: typeof body?.trustReportId === "string" ? body.trustReportId : "",
        reviewerId: typeof body?.reviewerId === "string" ? body.reviewerId : "",
        decision: typeof body?.decision === "string" ? body.decision as RecordHumanGovernanceDecisionRequest["decision"] : "" as RecordHumanGovernanceDecisionRequest["decision"],
        reason: typeof body?.reason === "string" ? body.reason : undefined,
      });
      respondJson(res, response.status === "created" ? 201 : 400, response);
    } catch (error) {
      respondJson(res, 400, { error: (error as Error).message });
    }
    return;
  }

  if (url.pathname === "/api/agent-promotion") {
    if (req.method !== "POST") {
      respondJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      const body = await readJsonBody(req);
      const response = handlePromotionCommand({
        operation: typeof body?.operation === "string" ? body.operation as never : undefined,
        proposalId: typeof body?.proposalId === "string" ? body.proposalId : undefined,
        agentId: typeof body?.agentId === "string" ? body.agentId : undefined,
        trustReportId: typeof body?.trustReportId === "string" ? body.trustReportId : undefined,
        governanceDecisionId: typeof body?.governanceDecisionId === "string" ? body.governanceDecisionId : undefined,
        promotionType: typeof body?.promotionType === "string" ? body.promotionType : undefined,
        confirmationId: typeof body?.confirmationId === "string" ? body.confirmationId : undefined,
        reviewerId: typeof body?.reviewerId === "string" ? body.reviewerId : undefined,
        confirmation: typeof body?.confirmation === "string" ? body.confirmation : undefined,
        promotionId: typeof body?.promotionId === "string" ? body.promotionId : undefined,
      }, req.headers["x-novara-promotion-key"] as string | undefined);
      respondJson(res, response.status === "invalid-request" ? 400 : response.result.status === "rejected" ? 400 : 201, response);
    } catch (error) {
      respondJson(res, 400, { error: (error as Error).message });
    }
    return;
  }

  if (url.pathname === "/api/content-review") {
    if (req.method !== "GET") {
      respondJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const response = handleContentReviewReadCommand({
      operation: url.searchParams.get("operation") as "listProposals" | "getProposal" | undefined,
      proposalId: url.searchParams.get("proposalId") ?? undefined,
    });
    respondJson(res, response.status === "invalid-request" ? 400 : 200, response);
    return;
  }

  if (url.pathname === "/api/content-proposal") {
    if (req.method !== "POST") { respondJson(res, 405, { error: "Method not allowed" }); return; }
    try {
      const body = await readJsonBody(req);
      const content = typeof body?.content === "string" ? body.content.trim() : "";
      const platform = typeof body?.platform === "string" ? body.platform.trim() : "";
      const goal = typeof body?.goal === "string" ? body.goal.trim() : "";
      if (!content || !platform) { respondJson(res, 400, { error: "content and platform are required" }); return; }
      const objective = `${goal || "Create an engaging short-form video concept"} for ${platform}.`;
      const response = await runtimeHost.getRuntime().executeSpecialist("A-014", { id: `content-input-${Date.now()}`, objective, input: { content: `${content}\n\nTarget platform: ${platform}` } });
      respondJson(res, response.result.status === "completed" ? 201 : 400, response);
    } catch (error) { respondJson(res, 400, { error: (error as Error).message }); }
    return;
  }

  if (url.pathname === "/api/openai-connection") {
    if (req.method === "GET") { respondJson(res, 200, readOpenAiConnectionStatus()); return; }
    if (req.method === "POST") { try { const body = await readJsonBody(req); saveOpenAiKey(envPath, typeof body?.apiKey === "string" ? body.apiKey : ""); respondJson(res, 200, { configured: true }); } catch (error) { respondJson(res, 400, { error: (error as Error).message }); } return; }
    respondJson(res, 405, { error: "Method not allowed" }); return;
  }

  if (url.pathname === "/api/openai-connection/test") {
    if (req.method !== "POST") { respondJson(res, 405, { error: "Method not allowed" }); return; }
    respondJson(res, 200, await testOpenAiConnection()); return;
  }

  if (url.pathname === "/api/elevenlabs-connection") {
    if (req.method === "GET") { respondJson(res, 200, readElevenLabsConnectionStatus()); return; }
    if (req.method === "POST") { try { const body = await readJsonBody(req); const modelId = typeof body?.modelId === "string" && body.modelId.trim() ? body.modelId : undefined; saveElevenLabsConnection(envPath, typeof body?.apiKey === "string" ? body.apiKey : "", typeof body?.voiceId === "string" ? body.voiceId : "", modelId); respondJson(res, 200, { configured: true }); } catch (error) { respondJson(res, 400, { error: (error as Error).message }); } return; }
    respondJson(res, 405, { error: "Method not allowed" }); return;
  }
  if (url.pathname === "/api/elevenlabs-connection/test") {
    if (req.method !== "POST") { respondJson(res, 405, { error: "Method not allowed" }); return; }
    respondJson(res, 200, await testElevenLabsConnection()); return;
  }

  if (url.pathname === "/api/metricool-connection") {
    if (req.method === "GET") { respondJson(res, 200, readMetricoolConnectionStatus()); return; }
    if (req.method === "POST") { try { const body = await readJsonBody(req); saveMetricoolConnection(envPath, typeof body?.apiKey === "string" ? body.apiKey : "", typeof body?.userId === "string" ? body.userId : "", typeof body?.blogId === "string" ? body.blogId : ""); respondJson(res, 200, readMetricoolConnectionStatus()); } catch (error) { respondJson(res, 400, { error: (error as Error).message }); } return; }
    respondJson(res, 405, { error: "Method not allowed" }); return;
  }
  if (url.pathname === "/api/metricool-connection/test") {
    if (req.method !== "POST") { respondJson(res, 405, { error: "Method not allowed" }); return; }
    respondJson(res, 200, await testMetricoolConnection()); return;
  }

  if (url.pathname === "/api/revenuecat-connection") {
    if (req.method === "GET") { respondJson(res, 200, readRevenueCatConnectionStatus()); return; }
    if (req.method === "POST") { try { const body = await readJsonBody(req); const result = await configureRevenueCatConnection(envPath, typeof body?.apiKey === "string" ? body.apiKey : "", typeof body?.projectId === "string" ? body.projectId : undefined); respondJson(res, result.test === "failed" ? 400 : 200, result); } catch (error) { respondJson(res, 400, { error: (error as Error).message }); } return; }
    respondJson(res, 405, { error: "Method not allowed" }); return;
  }
  if (url.pathname === "/api/revenuecat-connection/test") {
    if (req.method !== "POST") { respondJson(res, 405, { error: "Method not allowed" }); return; }
    respondJson(res, 200, await testRevenueCatConnection()); return;
  }

  if (url.pathname === "/api/content-review-access") {
    if (req.method === "GET") { respondJson(res, 200, readContentReviewAccessStatus()); return; }
    if (req.method === "POST") { try { const body = await readJsonBody(req); saveContentReviewAccess(envPath, typeof body?.credential === "string" ? body.credential : ""); respondJson(res, 200, { configured: true }); } catch (error) { respondJson(res, 400, { error: (error as Error).message }); } return; }
    respondJson(res, 405, { error: "Method not allowed" }); return;
  }

  if (url.pathname === "/api/production-access") {
    if (req.method === "GET") { respondJson(res, 200, readProductionAccessStatus()); return; }
    if (req.method === "POST") { try { const body = await readJsonBody(req); saveProductionAccess(envPath, typeof body?.credential === "string" ? body.credential : ""); respondJson(res, 200, { configured: true }); } catch (error) { respondJson(res, 400, { error: (error as Error).message }); } return; }
    respondJson(res, 405, { error: "Method not allowed" }); return;
  }

  if (url.pathname === "/api/publishing-access") {
    if (req.method === "GET") { respondJson(res, 200, readPublishingAccessStatus()); return; }
    if (req.method === "POST") { try { const body = await readJsonBody(req); savePublishingAccess(envPath, typeof body?.credential === "string" ? body.credential : ""); respondJson(res, 200, { configured: true }); } catch (error) { respondJson(res, 400, { error: (error as Error).message }); } return; }
    respondJson(res, 405, { error: "Method not allowed" }); return;
  }

  if (url.pathname === "/api/content-review-decision") {
    if (req.method !== "POST") {
      respondJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      const body = await readJsonBody(req);
      const response = handleContentReviewDecisionCommand({
        operation: typeof body?.operation === "string" ? body.operation as never : undefined,
        proposalId: typeof body?.proposalId === "string" ? body.proposalId : undefined,
        reason: typeof body?.reason === "string" ? body.reason : undefined,
      }, req.headers["x-novara-content-review-key"] as string | undefined);
      respondJson(res, response.status === "invalid-request" ? 400 : response.result.status === "rejected" ? 400 : 201, response);
    } catch (error) {
      respondJson(res, 400, { error: (error as Error).message });
    }
    return;
  }

  if (url.pathname === "/api/publishing-queue") {
    if (req.method !== "GET") {
      respondJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const response = handlePublishingQueueReadCommand({
      operation: url.searchParams.get("operation") as "listEntries" | "getEntry" | undefined,
      queueEntryId: url.searchParams.get("queueEntryId") ?? undefined,
    });
    respondJson(res, response.status === "invalid-request" ? 400 : 200, response);
    return;
  }

  if (url.pathname === "/api/publishing-queue-enqueue") {
    if (req.method !== "POST") {
      respondJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      const body = await readJsonBody(req);
      const response = handlePublishingQueueEnqueueCommand({
        operation: typeof body?.operation === "string" ? body.operation as never : undefined,
        proposalId: typeof body?.proposalId === "string" ? body.proposalId : undefined,
      }, req.headers["x-novara-publishing-queue-key"] as string | undefined);
      respondJson(res, response.status === "invalid-request" ? 400 : response.result.status === "rejected" ? 400 : 201, response);
    } catch (error) {
      respondJson(res, 400, { error: (error as Error).message });
    }
    return;
  }

  if (url.pathname === "/api/production-execute") {
    if (req.method !== "POST") {
      respondJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      const body = await readJsonBody(req);
      const response = await handleProductionExecutionCommand({
        operation: body?.operation,
        proposalId: typeof body?.proposalId === "string" ? body.proposalId : undefined,
      }, req.headers["x-novara-production-key"] as string | undefined);
      respondJson(res, response.status === "invalid-request" ? 400 : 200, response);
    } catch {
      respondJson(res, 400, { error: "Invalid production execution request" });
    }
    return;
  }

  if (url.pathname === "/api/production-approval") {
    if (req.method !== "POST") { respondJson(res, 405, { error: "Method not allowed" }); return; }
    try {
      const body = await readJsonBody(req);
      const response = handleProductionApprovalCommand({ operation: body?.operation, proposalId: typeof body?.proposalId === "string" ? body.proposalId : undefined, productionBriefId: typeof body?.productionBriefId === "string" ? body.productionBriefId : undefined, decision: body?.decision, reason: typeof body?.reason === "string" ? body.reason : undefined }, req.headers["x-novara-production-key"] as string | undefined);
      respondJson(res, response.status === "invalid-request" ? 400 : 200, response);
    } catch { respondJson(res, 400, { error: "Invalid production approval request" }); }
    return;
  }

  if (url.pathname === "/api/production-brief") {
    if (req.method !== "POST") { respondJson(res, 405, { error: "Method not allowed" }); return; }
    try {
      const body = await readJsonBody(req);
      const response = handleProductionBriefCommand({ operation: body?.operation, proposalId: typeof body?.proposalId === "string" ? body.proposalId : undefined }, req.headers["x-novara-production-key"] as string | undefined);
      respondJson(res, response.status === "invalid-request" ? 400 : 200, response);
    } catch { respondJson(res, 400, { error: "Invalid Production Brief request" }); }
    return;
  }

  if (url.pathname === "/api/institutional-knowledge") {
    try {
      const credential = req.headers["x-novara-institutional-knowledge-key"] as string | undefined;
      if (req.method === "GET") {
        const response = handleInstitutionalKnowledgeCommand({ operation: (url.searchParams.get("operation") ?? "listProposals") as never, proposalId: url.searchParams.get("proposalId") ?? undefined }, credential);
        respondJson(res, response.status === "invalid-request" ? 400 : 200, response);
      } else if (req.method === "POST") {
        const body = await readJsonBody(req);
        const response = handleInstitutionalKnowledgeCommand(body, credential);
        respondJson(res, response.status === "invalid-request" ? 400 : 200, response);
      } else respondJson(res, 405, { error: "Method not allowed" });
    } catch { respondJson(res, 400, { error: "Invalid institutional knowledge request" }); }
    return;
  }

  if (url.pathname === "/api/production-status") {
    if (req.method !== "GET") {
      respondJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const response = handleProductionStatusCommand({
      operation: "readProductionStatus",
      proposalId: url.searchParams.get("proposalId") ?? undefined,
    }, req.headers["x-novara-production-key"] as string | undefined);
    respondJson(res, response.status === "invalid-request" ? 400 : response.status === "not-found" ? 404 : 200, response);
    return;
  }

  if (url.pathname === "/api/metricool-status") {
    if (req.method !== "GET") {
      respondJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const response = await handleMetricoolStatusCommand();
    respondJson(res, 200, response);
    return;
  }

  if (url.pathname === "/api/metricool-preflight") {
    if (req.method !== "POST") {
      respondJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      const body = await readJsonBody(req);
      const response = await handleMetricoolPreflightCommand({
        operation: typeof body?.operation === "string" ? body.operation as never : undefined,
        queueEntryId: typeof body?.queueEntryId === "string" ? body.queueEntryId : undefined,
      }, req.headers["x-novara-metricool-key"] as string | undefined);
      respondJson(res, response.status === "invalid-request" ? 400 : response.result.status === "validation-failed" ? 400 : 200, response);
    } catch (error) {
      respondJson(res, 400, { error: (error as Error).message });
    }
    return;
  }

  if (url.pathname === "/api/publishing-execute") {
    if (req.method !== "POST") {
      respondJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      const body = await readJsonBody(req);
      const response = await handleMetricoolPublishingCommand({
        operation: typeof body?.operation === "string" ? body.operation as never : undefined,
        queueEntryId: typeof body?.queueEntryId === "string" ? body.queueEntryId : undefined,
      }, req.headers["x-novara-metricool-publishing-key"] as string | undefined);
      const resultStatus = response.status === "ok" ? response.result.status : undefined;
      respondJson(res, response.status === "invalid-request" || resultStatus === "failed" ? 400 : 200, response);
    } catch (error) {
      respondJson(res, 400, { error: (error as Error).message });
    }
    return;
  }

  if (url.pathname === "/api/hermes/ask") {
    try {
      const runtime = runtimeHost.getRuntime();
      const snapshot = await getSnapshot(runtimeHost);
      let question = "";

      if (req.method === "POST") {
        const body = await readJsonBody(req);
        question = String(body?.question ?? "").trim();
        if (!question) {
          respondJson(res, 400, { error: "Missing question" });
          return;
        }
      } else if (req.method === "GET") {
        question = String(url.searchParams.get("q") ?? "").trim();
      } else {
        respondJson(res, 405, { error: "Method not allowed" });
        return;
      }

      const routingResponse = routeHermesRequest(runtime, question, `TASK-HERMES-${Date.now()}`);
      if (routingResponse) {
        respondJson(res, 200, {
          question,
          ...routingResponse,
        });
        return;
      }

      respondJson(res, 200, {
        question,
        ...buildHermesReply(question, snapshot),
      });
    } catch (error) {
      respondJson(res, 500, { error: (error as Error).message });
    }
    return;
  }

  await serveStatic(res, url.pathname);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await loadEnvFile(envPath);
  const runtimeHost = createRuntimeHost();
  const server = createCommandInterfaceServer(runtimeHost);
  const port = Number(process.env.NOVARA_UI_PORT ?? 4173);
  server.listen(port, () => {
    const health = runtimeHost.getHealth();
    if (!health.initialized) {
      console.error(`Novara command interface failed runtime initialization: ${health.error}`);
    }
    console.log(`Novara command interface running on http://localhost:${port}`);
  });
}
