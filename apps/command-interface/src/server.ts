import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { AgentRuntime } from "../../../core/agent-runtime/src/runtime.ts";
import { getAgentDefinitions } from "../../../core/agent-runtime/src/agent.ts";

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

function buildRuntimeWithEvidence(metricool: MetricoolEvidence, objective: string): AgentRuntime {
  const runtime = new AgentRuntime();
  for (const definition of getAgentDefinitions()) {
    runtime.registerAgent(definition);
  }

  runtime.storeMemory({
    entry: {
      id: "mem-metricool-evidence-ui",
      type: "evidence",
      content: {
        source: "Metricool MCP",
        opportunity: "Novara Socials growth sprint",
        facts: metricool.facts,
        missing: metricool.unresolvedQuestions,
        assessment: metricool.status,
      },
      source: "Metricool MCP/Obsidian",
      timestamp: new Date().toISOString(),
      confidence: 0.32,
      authority: "recommend",
      status: "proposed",
    },
  });

  runtime.execute("A-001", {
    id: "TASK-COMMAND-UI-001",
    objective,
    input: {
      focus: "CEO command interface briefing",
    },
  });

  return runtime;
}

async function getSnapshot() {
  const metricoolMarkdown = await readIfExists(metricoolNotePath);
  const strategicMarkdown = await readIfExists(strategicDecisionPath);
  const objectiveMarkdown = await readIfExists(currentObjectivesPath);

  const metricool = parseMetricoolEvidence(metricoolMarkdown);
  const strategicDecision = parseStrategicDecision(strategicMarkdown);
  const objective =
    parseBullets(objectiveMarkdown, "Current Strategic Focus")[0] ??
    "Build a durable social attention engine for Novara.";

  const runtime = buildRuntimeWithEvidence(metricool, objective);
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

await loadEnvFile(envPath);

const server = createServer(async (req, res) => {
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

  if (url.pathname === "/api/command-interface") {
    try {
      respondJson(res, 200, await getSnapshot());
    } catch (error) {
      respondJson(res, 500, { error: (error as Error).message });
    }
    return;
  }

  if (url.pathname === "/api/hermes/ask") {
    try {
      const snapshot = await getSnapshot();
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

const port = Number(process.env.NOVARA_UI_PORT ?? 4173);
server.listen(port, () => {
  console.log(`Novara command interface running on http://localhost:${port}`);
});
