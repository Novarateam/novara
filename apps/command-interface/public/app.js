import { createNoopVoiceProvider, createServerVoiceProvider, createVoiceController } from "./modules/voice-provider.js";
import { VOICE_MODES, createVoiceState } from "./modules/voice-state.js";

const PROTOTYPE_COLORS = {
  bgPage: "#060708",
  bgPanel: "rgba(255,255,255,0.025)",
  bgCard: "rgba(255,255,255,0.04)",
  borderSubtle: "rgba(255,255,255,0.09)",
  textPrimary: "#eef1f5",
  textSecondary: "#9aa3ad",
  textTertiary: "#5b6470",
  accent: "#7fb3ff",
  danger: "#d9635a",
  warning: "#d9a05b",
};

const VOICE_STYLE = {
  idle: {
    edgeAnim: "edgeIdle 4s ease-in-out infinite",
    spinAnim: "ringSpin 30s linear infinite",
    baseGlow: 0.35,
    breatheAnim: "heartBeat 3.4s ease-in-out infinite",
    heartBrightness: 0.85,
    energyOpacity: 0.12,
  },
  listening: {
    edgeAnim: "edgeListening 1.6s ease-in-out infinite",
    spinAnim: "ringSpin 14s linear infinite",
    baseGlow: 0.6,
    breatheAnim: "heartBeat 1.5s ease-in-out infinite",
    heartBrightness: 1.05,
    energyOpacity: 0.28,
  },
  thinking: {
    edgeAnim: "edgeThinking 1s ease-in-out infinite",
    spinAnim: "ringSpinFast 3s linear infinite",
    baseGlow: 0.65,
    breatheAnim: "heartBeatFast 0.9s ease-in-out infinite",
    heartBrightness: 1.2,
    energyOpacity: 0.4,
  },
  speaking: {
    edgeAnim: "none",
    spinAnim: "ringSpinFast 2s linear infinite",
    baseGlow: 0.4,
    breatheAnim: "heartBeatFast 0.6s ease-in-out infinite",
    heartBrightness: 1.4,
    energyOpacity: 0.6,
  },
};

const appState = {
  snapshot: null,
  voice: createVoiceState(),
  voiceProvider: null,
  sphere: null,
  sphereAnimationFrame: null,
  sphereAnimationNodes: null,
  sphereAnimationStartedAt: 0,
  sphereLastAnimationFrame: 0,
  sphereNextPulseAt: 0,
  spherePulseStartedAt: 0,
  spherePulseDuration: 0,
  voiceSequenceTimer: null,
  voiceBusy: false,
  queryDraft: "",
  activeView: "dashboard",
  audioReactiveLevel: 0,
  // Real GET /api/runtime/health state: "unknown" | "healthy" | "degraded" | "unreachable".
  health: { state: "unknown", body: null },
  // Real GET /api/trust-review?operation=listTrustReports state: "loading" | "ok" | "empty" | "error".
  trustReview: { status: "loading", reports: [] },
  // Real GET /api/content-review?operation=listProposals state: "loading" | "ok" | "empty" | "error".
  contentReview: { status: "loading", proposals: [] },
  contentReviewBusyProposalId: null,
  contentDraft: { content: "", platform: "TikTok", goal: "" },
  contentReviewAccess: { configured: false },
  contentReviewAccessModalOpen: false,
  institutionalKnowledge: { status: "idle", proposals: [], error: "" },
  productionControl: { status: "idle", proposalId: "", data: null, error: "" },
  productionControlBusy: false,
  productionBriefResult: "",
  productionAccess: { configured: false },
  productionAccessModalOpen: false,
  // Real GET /api/publishing-queue?operation=listEntries state: "loading" | "ok" | "empty" | "error".
  publishingQueue: { status: "loading", entries: [] },
  publishingQueueBusyProposalId: null,
  publishingAccess: { configured: false },
  publishingAccessModalOpen: false,
  metricoolPublishBusyEntryId: null,
  // Real GET /api/metricool-status state: "loading" | "not-configured" | "unavailable" | "ready" | "error".
  metricoolStatus: { state: "loading", reason: "" },
  openAiConnection: { configured: false, test: "untested" },
  openAiModalOpen: false,
  elevenLabsConnection: { configured: false, test: "untested" },
  elevenLabsModalOpen: false,
  elevenLabsDraft: { voiceId: "", modelId: "" },
  metricoolConnection: { configured: false, userId: "", blogId: "", test: "untested" },
  metricoolApiModalOpen: false,
  metricoolDraft: { userId: "", blogId: "" },
  revenueCatConnection: { configured: false, projectName: "", projectId: "", test: "untested" },
  revenueCatModalOpen: false,
  revenueCatDraft: { projectId: "", projects: [] },
  spiderwebFocusDepartmentId: null,
  metricoolPreflightBusyEntryId: null,
};

const HEALTH_POLL_INTERVAL_MS = 15000;
const TRUST_REVIEW_POLL_INTERVAL_MS = 60000;
const CONTENT_REVIEW_POLL_INTERVAL_MS = 45000;
const PUBLISHING_QUEUE_POLL_INTERVAL_MS = 45000;
// Deliberately conservative: this poll may contact the real external Metricool endpoint
// when configured, so it must not be aggressive (see Section 3C: avoid contacting Metricool
// on ordinary reads where avoidable).
const METRICOOL_STATUS_POLL_INTERVAL_MS = 90000;

const voiceController = createVoiceController({
  onChange: (nextState) => {
    appState.voice = nextState;
    render();
  },
});

function setVoiceProvider(provider) {
  appState.voiceProvider = provider;
  voiceController.attachProvider(provider);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function setAudioReactiveLevel(level) {
  appState.audioReactiveLevel = clamp01(level);
  applySphereReactiveStyle();
}

setVoiceProvider(
  createServerVoiceProvider({
    onAudioLevel: (level) => {
      setAudioReactiveLevel(level);
    },
  }),
);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeSnapshot(snapshot) {
  const commandInterface = snapshot.commandInterface ?? {};
  const state = snapshot.companyBrief?.state ?? {};
  const agents = snapshot.agents ?? [];

  return {
    ...snapshot,
    commandInterface: {
      companyPulse: {
        revenue: commandInterface.companyPulse?.revenue ?? null,
        subscribers: commandInterface.companyPulse?.subscribers ?? null,
        subscribersTrend: commandInterface.companyPulse?.subscribersTrend ?? null,
        clicks: commandInterface.companyPulse?.clicks ?? null,
        clicksTrend: commandInterface.companyPulse?.clicksTrend ?? null,
        views: commandInterface.companyPulse?.views ?? null,
        viewsTrend: commandInterface.companyPulse?.viewsTrend ?? null,
        channelsActive: commandInterface.companyPulse?.channelsActive ?? null,
        agentsActive: commandInterface.companyPulse?.agentsActive ?? agents.length,
      },
      currentNext: {
        currently: commandInterface.currentNext?.currently ?? state.activeWork?.[0] ?? null,
        next: commandInterface.currentNext?.next ?? state.pendingDecisions?.[0] ?? null,
      },
      monthlyGoal: {
        label: commandInterface.monthlyGoal?.label ?? "MONTHLY TURNOVER GOAL",
        current: commandInterface.monthlyGoal?.current ?? null,
        target: commandInterface.monthlyGoal?.target ?? null,
        remaining: commandInterface.monthlyGoal?.remaining ?? null,
        progress: commandInterface.monthlyGoal?.progress ?? null,
        pace: commandInterface.monthlyGoal?.pace ?? null,
        configured: commandInterface.monthlyGoal?.configured ?? false,
      },
      autonomy: {
        status: commandInterface.autonomy?.status ?? "Operational",
        level: commandInterface.autonomy?.level ?? "2",
        percent: commandInterface.autonomy?.percent ?? 42,
      },
      agentCount: commandInterface.agentCount ?? agents.length,
      agentNames: commandInterface.agentNames ?? agents.map((agent) => agent.name ?? agent.id ?? "Agent"),
    },
  };
}

function formatNoData(value) {
  return value == null || value === "" ? "No data" : value;
}

function buildMetrics(snapshot) {
  const pulse = snapshot.commandInterface.companyPulse;
  return [
    { label: "REVENUE", value: formatNoData(pulse.revenue), growth: "", arrow: "" },
    {
      label: "SUBSCRIBERS",
      value: formatNoData(pulse.subscribers),
      growth: pulse.subscribersTrend == null ? "" : `${Math.abs(pulse.subscribersTrend).toFixed(1)}%`,
      arrow: pulse.subscribersTrend == null ? "" : pulse.subscribersTrend >= 0 ? "▲" : "▼",
    },
    {
      label: "CLICKS",
      value: formatNoData(pulse.clicks),
      growth: pulse.clicksTrend == null ? "" : `${Math.abs(pulse.clicksTrend).toFixed(1)}%`,
      arrow: pulse.clicksTrend == null ? "" : pulse.clicksTrend >= 0 ? "▲" : "▼",
    },
    {
      label: "VIEWS",
      value: formatNoData(pulse.views),
      growth: pulse.viewsTrend == null ? "" : `${Math.abs(pulse.viewsTrend).toFixed(1)}%`,
      arrow: pulse.viewsTrend == null ? "" : pulse.viewsTrend >= 0 ? "▲" : "▼",
    },
    {
      label: "CHANNELS ACTIVE",
      value: pulse.channelsActive == null ? "No data" : String(pulse.channelsActive),
      growth: pulse.channelsActive == null ? "" : "Active",
      arrow: pulse.channelsActive == null ? "" : "●",
    },
    {
      label: "AGENTS ACTIVE",
      value: pulse.agentsActive == null ? "No data" : String(pulse.agentsActive),
      growth: pulse.agentsActive == null ? "" : "Active",
      arrow: pulse.agentsActive == null ? "" : "▲",
    },
  ];
}

function buildAttentionItems(snapshot) {
  const state = snapshot.companyBrief?.state ?? {};
  const items = [];

  // Full lists are rendered (no truncation) so nothing needing attention is hidden.
  for (const decision of state.pendingDecisions ?? []) {
    items.push({ color: PROTOTYPE_COLORS.danger, category: "APPROVAL", title: decision, subtitle: "Human decision required" });
  }

  for (const risk of state.risks ?? []) {
    items.push({ color: PROTOTYPE_COLORS.warning, category: "WARNING", title: risk, subtitle: "Investigate before escalation" });
  }

  return items;
}

const SPIDERWEB_DEPARTMENTS = [
  { id: "leadership", label: "Leadership", functionLabel: "coordination", agentIds: ["A-001"] },
  { id: "evidence", label: "Evidence", functionLabel: "research", agentIds: ["A-002", "A-003"] },
  { id: "audience-strategy", label: "Audience & Strategy", functionLabel: "planning", agentIds: ["A-004", "A-005"] },
  { id: "creative-production", label: "Creative Production", functionLabel: "concept to draft", agentIds: ["A-006", "A-007", "A-014"] },
  { id: "quality-distribution", label: "Quality & Distribution", functionLabel: "review & readiness", agentIds: ["A-008", "A-009"] },
  { id: "growth-commercial", label: "Growth & Commercial", functionLabel: "measure & economics", agentIds: ["A-010", "A-011"] },
  { id: "signals-policy", label: "Signals & Policy", functionLabel: "trend & policy", agentIds: ["A-012", "A-013"] },
];

const SPIDERWEB_HEALTH_COLORS = {
  healthy: "#8fdc8f",
  attention: PROTOTYPE_COLORS.warning,
  poor: PROTOTYPE_COLORS.danger,
  neutral: PROTOTYPE_COLORS.textTertiary,
};

const SPIDERWEB_VIEWBOX_SIZE = 448;
const SPIDERWEB_RENDER_SIZE = 448;
const SPIDERWEB_CENTER = SPIDERWEB_VIEWBOX_SIZE / 2;
const SPIDERWEB_MARGIN = 30;
const SPIDERWEB_T2_RADIUS = 220;
const SPIDERWEB_T3_OFFSET = 70;
const SPIDERWEB_T4_OFFSET = 60;
const SPIDERWEB_T3_SIBLING_SPREAD = 60;
const SPIDERWEB_T4_SIBLING_SPREAD = 45;
const SPIDERWEB_NODE_WIDTH = 150;
const SPIDERWEB_NODE_HEIGHT = 30;

const SPIDERWEB_POSITIONS = {
  center: { x: 224, y: 224 },
  departments: {
    leadership: { x: 224, y: 116 },
    evidence: { x: 320, y: 144 },
    audienceStrategy: { x: 344, y: 224 },
    creativeProduction: { x: 320, y: 304 },
    qualityDistribution: { x: 224, y: 332 },
    growthCommercial: { x: 128, y: 304 },
    signalsPolicy: { x: 104, y: 144 },
  },
  functions: {
    leadership: { x: 224, y: 74 },
    evidence: { x: 354, y: 116 },
    audienceStrategy: { x: 388, y: 224 },
    creativeProduction: { x: 354, y: 332 },
    qualityDistribution: { x: 224, y: 374 },
    growthCommercial: { x: 94, y: 332 },
    signalsPolicy: { x: 60, y: 116 },
  },
  agents: {
    "A-001": { x: 224, y: 34 },
    "A-002": { x: 372, y: 90 },
    "A-003": { x: 372, y: 138 },
    "A-004": { x: 372, y: 198 },
    "A-005": { x: 372, y: 250 },
    "A-006": { x: 356, y: 356 },
    "A-007": { x: 338, y: 392 },
    "A-014": { x: 382, y: 392 },
    "A-008": { x: 186, y: 402 },
    "A-009": { x: 262, y: 402 },
    "A-010": { x: 76, y: 356 },
    "A-011": { x: 76, y: 392 },
    "A-012": { x: 62, y: 90 },
    "A-013": { x: 62, y: 138 },
  },
};

function estimateSpiderwebLabelWidth(text, minimum, perCharacter, maximum) {
  const length = String(text ?? "").trim().length;
  return Math.max(minimum, Math.min(maximum, minimum + length * perCharacter));
}

function toSpiderwebSvgPoint(point) {
  return {
    x: point.x,
    y: point.y,
  };
}

function getAgentHealth(agent) {
  const completed = Number(agent?.performance?.completedTasks ?? 0);
  const failed = Number(agent?.performance?.failedTasks ?? 0);
  if (failed > completed && failed > 0) {
    return "poor";
  }
  if (completed > 0 && failed === 0) {
    return "healthy";
  }
  if (agent?.status === "planned" || agent?.executionState === "planned") {
    return "attention";
  }
  return "neutral";
}

function aggregateDepartmentHealth(agents) {
  const healthStates = agents.map((agent) => getAgentHealth(agent));
  if (healthStates.includes("poor")) return "poor";
  if (healthStates.includes("healthy") && healthStates.includes("attention")) return "attention";
  if (healthStates.includes("healthy")) return "healthy";
  if (healthStates.includes("attention")) return "attention";
  return "neutral";
}

function layoutSpiderweb(snapshot) {
  const agents = Array.isArray(snapshot.agents) ? snapshot.agents : [];
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const departments = SPIDERWEB_DEPARTMENTS.map((department) => ({
    ...department,
    agents: department.agentIds.map((agentId) => agentsById.get(agentId)).filter(Boolean),
  })).filter((department) => department.agents.length > 0);

  const center = { ...SPIDERWEB_POSITIONS.center };

  const laidOutDepartments = departments.map((department) => {
    const key = department.id === "audience-strategy" ? "audienceStrategy" : department.id === "creative-production" ? "creativeProduction" : department.id === "quality-distribution" ? "qualityDistribution" : department.id === "growth-commercial" ? "growthCommercial" : department.id === "signals-policy" ? "signalsPolicy" : department.id;
    const departmentPoint = { ...SPIDERWEB_POSITIONS.departments[key] };
    const functionPoint = { ...SPIDERWEB_POSITIONS.functions[key] };
    const agentData = department.agents.map((agent) => {
      const agentPoint = SPIDERWEB_POSITIONS.agents[agent.id] ?? functionPoint;
      return {
        agent,
        health: getAgentHealth(agent),
        labelWidth: estimateSpiderwebLabelWidth(`${agentDisplayId(agent)} ${agentDisplayName(agent)}`, SPIDERWEB_NODE_WIDTH, 3, 188),
        point: { ...agentPoint },
        svgPoint: toSpiderwebSvgPoint(agentPoint),
      };
    });

    return {
      ...department,
      health: aggregateDepartmentHealth(department.agents),
      point: departmentPoint,
      svgPoint: toSpiderwebSvgPoint(departmentPoint),
      functionPoint,
      functionSvgPoint: toSpiderwebSvgPoint(functionPoint),
      agents: agentData,
    };
  });

  return {
    center,
    departments: laidOutDepartments,
    functions: laidOutDepartments.map((department) => ({
      departmentId: department.id,
      point: department.functionPoint,
      svgPoint: department.functionSvgPoint,
    })),
    agents: laidOutDepartments.flatMap((department) => department.agents.map((agent) => ({
      departmentId: department.id,
      health: agent.health,
      labelWidth: agent.labelWidth,
      point: agent.point,
      svgPoint: agent.svgPoint,
      agent: agent.agent,
    }))),
  };
}

function agentDisplayName(agent) {
  return String(agent?.name ?? agent?.id ?? "Agent");
}

function agentDisplayId(agent) {
  return String(agent?.id ?? "Agent");
}

function renderSpiderwebLine(x1, y1, x2, y2, color, opacity, width = 1) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.max(0, Math.hypot(dx, dy));
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return `<div style="position:absolute;left:${x1}px;top:${y1}px;width:${length}px;height:${width}px;background:${color};opacity:${opacity};transform:rotate(${angle}deg);transform-origin:0 50%;border-radius:${width}px;"></div>`;
}

// Reflects only the real GET /api/runtime/health response; never inferred from page load.
function describeHealth(health) {
  switch (health?.state) {
    case "healthy":
      return { label: "Healthy", color: PROTOTYPE_COLORS.accent };
    case "degraded":
      return { label: "Degraded / unavailable", color: PROTOTYPE_COLORS.warning };
    case "unreachable":
      return { label: "Unreachable", color: PROTOTYPE_COLORS.danger };
    default:
      return { label: "Checking\u2026", color: PROTOTYPE_COLORS.textTertiary };
  }
}

// Renders only what GET /api/trust-review?operation=listTrustReports actually returned.
function renderTrustReviewPanel(trustReview) {
  if (trustReview.status === "error") {
    return `<div style="font-size:16px;color:${PROTOTYPE_COLORS.textSecondary};">Trust & Review is currently unavailable.</div>`;
  }
  if (trustReview.status === "loading") {
    return `<div style="font-size:16px;color:${PROTOTYPE_COLORS.textTertiary};">Loading trust reports\u2026</div>`;
  }
  if (trustReview.status === "empty") {
    return `<div style="font-size:16px;color:${PROTOTYPE_COLORS.textTertiary};">No trust reports yet.</div>`;
  }
  return trustReview.reports
    .map(
      (report) => `<div style="padding:8px 0;border-bottom:1px solid ${PROTOTYPE_COLORS.borderSubtle};">
        <div style="font-size:15px;color:${PROTOTYPE_COLORS.textPrimary};">${escapeHtml(report.agentId ?? "Unknown agent")}</div>
        <div style="font-size:13px;color:${PROTOTYPE_COLORS.textSecondary};">Trust level: ${escapeHtml(report.trustLevel ?? "unknown")} \u00b7 Recommendation: ${escapeHtml(report.recommendation ?? "unknown")}</div>
      </div>`,
    )
    .join("");
}

function contentReviewStatusColor(status) {
  if (status === "approved") return PROTOTYPE_COLORS.accent;
  if (status === "rejected") return PROTOTYPE_COLORS.danger;
  return PROTOTYPE_COLORS.warning;
}

// Renders only what GET /api/content-review?operation=listProposals actually returned. Read-only:
// this function never fetches, executes, or mutates anything itself.
function renderContentReviewPanel(contentReview, busyProposalId) {
  if (contentReview.status === "error") {
    return `<div style="font-size:16px;color:${PROTOTYPE_COLORS.textSecondary};">Content review is currently unavailable.</div>`;
  }
  if (contentReview.status === "loading") {
    return `<div style="font-size:16px;color:${PROTOTYPE_COLORS.textTertiary};">Loading content proposals\u2026</div>`;
  }
  if (contentReview.status === "empty") {
    return `<div style="font-size:16px;color:${PROTOTYPE_COLORS.textTertiary};">No content proposals yet.</div>`;
  }

  return contentReview.proposals
    .map((proposal) => {
      const result = proposal.structuredResult ?? {};
      const decision = proposal.decision;
      const status = proposal.status ?? "proposed";
      const hashtags = Array.isArray(result.hashtags) ? result.hashtags.join(", ") : "";
      const reasons = Array.isArray(result.reasons) ? result.reasons.join("; ") : "";
      const isBusy = busyProposalId === proposal.proposalId;

      const actions =
        status === "proposed"
          ? `<div style="display:flex;gap:10px;margin-top:10px;">
              <button data-action="content-review-approve" data-proposal-id="${escapeHtml(proposal.proposalId)}" ${isBusy ? "disabled" : ""} style="cursor:pointer;padding:8px 14px;border-radius:8px;border:1px solid ${PROTOTYPE_COLORS.accent};background:transparent;color:${PROTOTYPE_COLORS.accent};font-family:'IBM Plex Mono',monospace;font-size:13px;">Approve</button>
              <button data-action="content-review-reject" data-proposal-id="${escapeHtml(proposal.proposalId)}" ${isBusy ? "disabled" : ""} style="cursor:pointer;padding:8px 14px;border-radius:8px;border:1px solid ${PROTOTYPE_COLORS.danger};background:transparent;color:${PROTOTYPE_COLORS.danger};font-family:'IBM Plex Mono',monospace;font-size:13px;">Reject</button>
            </div>`
          : `<div style="margin-top:10px;font-size:13px;color:${PROTOTYPE_COLORS.textSecondary};">
              Decided by ${escapeHtml(decision?.reviewerId ?? "unknown")} at ${escapeHtml(decision?.recordedAt ?? "unknown time")}${decision?.reason ? ` \u2014 "${escapeHtml(decision.reason)}"` : ""}
            </div>`;

      return `<div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:12px;padding:14px 16px;margin-bottom:10px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div style="font-size:13px;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;">${escapeHtml(proposal.proposalId)} \u00b7 ${escapeHtml(proposal.agentId ?? "A-014")}</div>
          <div style="font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:${contentReviewStatusColor(status)};font-family:'IBM Plex Mono',monospace;">${escapeHtml(status)}</div>
        </div>
        <div style="font-size:14px;color:${PROTOTYPE_COLORS.textSecondary};margin-top:6px;">${escapeHtml(proposal.objective ?? "")}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;font-size:14px;color:${PROTOTYPE_COLORS.textPrimary};">
          <div><span style="color:${PROTOTYPE_COLORS.textTertiary};">Platform: </span>${escapeHtml(result.platform ?? "")}</div>
          <div><span style="color:${PROTOTYPE_COLORS.textTertiary};">Confidence: </span>${escapeHtml(result.confidence ?? "")}</div>
          <div><span style="color:${PROTOTYPE_COLORS.textTertiary};">Title: </span>${escapeHtml(result.title ?? "")}</div>
          <div><span style="color:${PROTOTYPE_COLORS.textTertiary};">Hook: </span>${escapeHtml(result.hook ?? "")}</div>
        </div>
        <div style="margin-top:8px;font-size:14px;color:${PROTOTYPE_COLORS.textPrimary};">${escapeHtml(result.caption ?? "")}</div>
        <div style="margin-top:6px;font-size:13px;color:${PROTOTYPE_COLORS.textSecondary};">${hashtags ? `#${hashtags.replaceAll(", ", " #")}` : ""}</div>
        <div style="margin-top:6px;font-size:13px;color:${PROTOTYPE_COLORS.textTertiary};">Angle: ${escapeHtml(result.angle ?? "")}</div>
        ${reasons ? `<div style="margin-top:6px;font-size:13px;color:${PROTOTYPE_COLORS.textTertiary};">Reasons: ${escapeHtml(reasons)}</div>` : ""}
        ${actions}
      </div>`;
    })
    .join("");
}

function renderInstitutionalKnowledgePanel() {
  const state = appState.institutionalKnowledge;
  const cards = (state.proposals ?? []).map(({ proposal, review }) => {
    const terminal = review?.decision;
    const label = terminal === "approved" ? "APPROVED - NOT APPLIED" : terminal === "rejected" ? "REJECTED" : "PENDING REVIEW";
    const color = terminal === "approved" ? PROTOTYPE_COLORS.accent : terminal === "rejected" ? PROTOTYPE_COLORS.danger : PROTOTYPE_COLORS.warning;
    return `<div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:10px;padding:12px;margin-top:10px;">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;"><span style="font:12px 'IBM Plex Mono',monospace;color:${PROTOTYPE_COLORS.textTertiary};">${escapeHtml(proposal.proposalId)}</span><span style="font:12px 'IBM Plex Mono',monospace;color:${color};">${label}</span></div>
      <div style="margin-top:6px;color:${PROTOTYPE_COLORS.textPrimary};">${escapeHtml(proposal.targetPath)}</div><div style="margin-top:4px;font-size:13px;color:${PROTOTYPE_COLORS.textSecondary};">Proposed by ${escapeHtml(proposal.proposerId)} at ${escapeHtml(proposal.createdAt)}</div>
      <div style="margin-top:7px;font-size:13px;color:${PROTOTYPE_COLORS.textSecondary};">${escapeHtml(proposal.rationale)}</div><div style="margin-top:7px;font:11px 'IBM Plex Mono',monospace;color:${PROTOTYPE_COLORS.textTertiary};word-break:break-all;">Baseline SHA-256: ${escapeHtml(proposal.baseContentHash)}</div>
      ${proposal.evidenceReferences?.length ? `<div style="margin-top:6px;font-size:12px;color:${PROTOTYPE_COLORS.textSecondary};">Evidence: ${escapeHtml(proposal.evidenceReferences.join(", "))}</div>` : ""}<pre style="margin:8px 0 0;padding:8px;white-space:pre-wrap;max-height:180px;overflow:auto;background:rgba(255,255,255,0.03);font-size:12px;color:${PROTOTYPE_COLORS.textPrimary};">${escapeHtml(proposal.proposedContent)}</pre>
      ${terminal ? `<div style="margin-top:8px;font-size:12px;color:${PROTOTYPE_COLORS.textSecondary};">Reviewed by ${escapeHtml(review.reviewerId)} at ${escapeHtml(review.reviewedAt)}${review.reason ? `: ${escapeHtml(review.reason)}` : ""}</div>` : `<div style="display:flex;gap:8px;margin-top:9px;"><button data-action="institutional-knowledge-approve" data-proposal-id="${escapeHtml(proposal.proposalId)}">Approve</button><button data-action="institutional-knowledge-reject" data-proposal-id="${escapeHtml(proposal.proposalId)}">Reject</button></div>`}
    </div>`;
  }).join("");
  return `<div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:16px;padding:16px 20px;background:${PROTOTYPE_COLORS.bgPanel};"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;"><div style="font:16px 'IBM Plex Mono',monospace;letter-spacing:.08em;color:${PROTOTYPE_COLORS.textTertiary};">INSTITUTIONAL KNOWLEDGE REVIEW</div><button data-action="institutional-knowledge-load">Load proposals</button></div><div style="display:grid;gap:7px;margin-top:12px;"><input data-input="institutional-target" placeholder="Target path, e.g. Company/Vision.md"><textarea data-input="institutional-content" placeholder="Exact proposed full replacement content"></textarea><input data-input="institutional-rationale" placeholder="Rationale"><input data-input="institutional-evidence" placeholder="Evidence references, comma-separated"><button data-action="institutional-knowledge-create">Create proposal</button></div>${state.error ? `<div style="margin-top:8px;color:${PROTOTYPE_COLORS.danger};">${escapeHtml(state.error)}</div>` : ""}${cards || `<div style="margin-top:12px;color:${PROTOTYPE_COLORS.textSecondary};">No proposals loaded.</div>`}</div>`;
}

function productionStatusColor(status) {
  switch (status) {
    case "not-ready":
      return PROTOTYPE_COLORS.warning;
    case "awaiting-production-approval":
      return PROTOTYPE_COLORS.accent;
    case "rejected-for-production":
      return PROTOTYPE_COLORS.danger;
    case "ready-to-produce":
      return PROTOTYPE_COLORS.accent;
    case "in-progress":
      return PROTOTYPE_COLORS.warning;
    case "blocked":
      return PROTOTYPE_COLORS.danger;
    case "failed":
      return PROTOTYPE_COLORS.danger;
    case "unknown-result":
      return PROTOTYPE_COLORS.warning;
    case "completed":
      return PROTOTYPE_COLORS.accent;
    default:
      return PROTOTYPE_COLORS.textSecondary;
  }
}

function renderProductionControlPanel() {
  const control = appState.productionControl ?? { status: "idle", proposalId: "", data: null, error: "" };
  const data = control.data;
  const proposalId = control.proposalId || (appState.contentReview?.proposals?.[0]?.proposalId ?? "");
  const summary = data?.summary;
  const stageEntries = summary ? [
    ["Production Brief", summary.stages.productionBrief?.status ?? "not-ready"],
    ["Visual", summary.stages.visual?.status ?? "not-created"],
    ["Narration", summary.stages.narration?.status ?? "not-created"],
    ["Alignment", summary.stages.alignment?.status ?? "not-created"],
    ["Subtitles", summary.stages.subtitle?.status ?? "not-created"],
    ["Video", summary.stages.video?.status ?? "not-created"],
  ] : [];

  const canApproveForProduction = Boolean(
    data &&
      data.contentReviewDecision?.decision === "approved" &&
      data.productionBrief &&
      data.productionBrief.productionReadiness === "ready" &&
      !data.productionApproval,
  );
  const canRejectForProduction = Boolean(
    data &&
      data.contentReviewDecision?.decision === "approved" &&
      data.productionBrief &&
      data.productionBrief.productionReadiness === "ready" &&
      !data.productionApproval,
  );
  const canProduce = Boolean(summary && summary.overallStatus === "ready-to-produce" && data?.productionApproval?.decision === "approved-for-production");
  const canNormalizeBrief = Boolean(data?.contentReviewDecision?.decision === "approved");
  const readyLabel = summary?.overallStatus ?? "not-ready";

  if (!proposalId) {
    return `<div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:16px;padding:16px 20px;background:${PROTOTYPE_COLORS.bgPanel};">
      <div style="font-size:16px;letter-spacing:0.08em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;margin-bottom:12px;">NOVARA PRODUCTION CONTROL</div>
      <div style="font-size:16px;color:${PROTOTYPE_COLORS.textSecondary};">No proposal is available yet for production control.</div>
    </div>`;
  }

  const selectOptions = Array.isArray(appState.contentReview?.proposals)
    ? appState.contentReview.proposals
        .map((proposal) => `<option value="${escapeHtml(proposal.proposalId)}" ${proposal.proposalId === proposalId ? "selected" : ""}>${escapeHtml(proposal.proposalId)}</option>`)
        .join("")
    : `<option value="${escapeHtml(proposalId)}" selected>${escapeHtml(proposalId)}</option>`;

  const statusLabel = summary ? summary.overallStatus : (control.status === "loading" ? "loading" : "not-ready");
  const finalVideoAssets = data?.stages?.video?.assets ?? [];
  const finalVideoHtml = summary?.overallStatus === "completed" && finalVideoAssets.length
    ? finalVideoAssets.map((asset) => `
        <div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:12px;padding:10px 12px;margin-top:9px;background:rgba(255,255,255,0.01);">
          <div style="font-size:13px;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;">Asset ID</div>
          <div style="font-size:15px;color:${PROTOTYPE_COLORS.textPrimary};margin-top:4px;">${escapeHtml(asset.assetId ?? "unknown")}</div>
          <div style="font-size:13px;color:${PROTOTYPE_COLORS.textSecondary};margin-top:6px;">Type: ${escapeHtml(asset.assetType ?? "video")}</div>
          ${asset.localPath ? `<div style="font-size:12px;color:${PROTOTYPE_COLORS.textSecondary};margin-top:4px;">Path: ${escapeHtml(asset.localPath)}</div>` : ""}
          ${asset.reference ? `<div style="font-size:12px;color:${PROTOTYPE_COLORS.textSecondary};margin-top:4px;">Reference: ${escapeHtml(asset.reference)}</div>` : ""}
        </div>
      `).join("")
    : summary?.overallStatus === "completed"
      ? `<div style="margin-top:10px;font-size:14px;color:${PROTOTYPE_COLORS.textSecondary};">Production completed, but no durable video asset metadata was returned by the status boundary.</div>`
      : "";

  return `<div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:16px;padding:16px 20px;background:${PROTOTYPE_COLORS.bgPanel};display:flex;flex-direction:column;gap:12px;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
      <div style="font-size:16px;letter-spacing:0.08em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;">NOVARA PRODUCTION CONTROL</div>
      <button data-action="production-status-refresh" data-proposal-id="${escapeHtml(proposalId)}" style="cursor:pointer;padding:8px 14px;border-radius:8px;border:1px solid ${PROTOTYPE_COLORS.accent};background:transparent;color:${PROTOTYPE_COLORS.accent};font-family:'IBM Plex Mono',monospace;font-size:13px;">Refresh</button>
    </div>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <label style="font-size:13px;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;">Proposal</label>
      <select data-production-proposal-select style="min-width:220px;background:rgba(255,255,255,0.02);border:1px solid ${PROTOTYPE_COLORS.borderSubtle};padding:8px 10px;border-radius:8px;color:${PROTOTYPE_COLORS.textPrimary};">
        ${selectOptions}
      </select>
      <button data-action="production-status-load" style="cursor:pointer;padding:8px 14px;border-radius:8px;border:1px solid ${PROTOTYPE_COLORS.borderSubtle};background:transparent;color:${PROTOTYPE_COLORS.textPrimary};font-family:'IBM Plex Mono',monospace;font-size:13px;">Load</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
      <div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:12px;padding:10px 12px;">
        <div style="font-size:12px;letter-spacing:0.06em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;">Proposal</div>
        <div style="font-size:15px;color:${PROTOTYPE_COLORS.textPrimary};margin-top:6px;">${escapeHtml(data?.proposalId ?? proposalId)}</div>
        <div style="font-size:13px;color:${PROTOTYPE_COLORS.textSecondary};margin-top:6px;">${escapeHtml(data?.contentReviewDecision?.decision ? `Content review: ${data.contentReviewDecision.decision}` : data?.productionBrief ? `Brief: ${data.productionBrief.productionReadiness}` : "No persisted proposal state yet")}</div>
      </div>
      <div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:12px;padding:10px 12px;">
        <div style="font-size:12px;letter-spacing:0.06em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;">Production Brief</div>
        <div style="font-size:15px;color:${PROTOTYPE_COLORS.textPrimary};margin-top:6px;">${escapeHtml(data?.productionBrief?.productionBriefId ?? "not available")}</div>
        <div style="font-size:13px;color:${PROTOTYPE_COLORS.textSecondary};margin-top:6px;">${escapeHtml(data?.productionBrief?.productionReadiness ?? "not ready")}</div>
        ${data?.productionBrief?.missingRequirements?.length ? `<div style="font-size:12px;color:${PROTOTYPE_COLORS.warning};margin-top:6px;">Missing: ${escapeHtml(data.productionBrief.missingRequirements.join(", "))}</div>` : ""}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
      <div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:12px;padding:10px 12px;">
        <div style="font-size:12px;letter-spacing:0.06em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;">Content Review</div>
        <div style="font-size:15px;color:${PROTOTYPE_COLORS.textPrimary};margin-top:6px;">${escapeHtml(data?.contentReviewDecision?.decision ?? "pending")}</div>
      </div>
      <div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:12px;padding:10px 12px;">
        <div style="font-size:12px;letter-spacing:0.06em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;">Production Approval</div>
        <div style="font-size:15px;color:${PROTOTYPE_COLORS.textPrimary};margin-top:6px;">${escapeHtml(data?.productionApproval?.decision ?? "awaiting")}</div>
      </div>
    </div>
    <div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:12px;padding:12px 12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <div style="font-size:12px;letter-spacing:0.06em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;">Pipeline</div>
        <div style="font-size:12px;letter-spacing:0.06em;color:${productionStatusColor(statusLabel)};font-family:'IBM Plex Mono',monospace;text-transform:uppercase;">${escapeHtml(statusLabel)}</div>
      </div>
      <div style="font-size:13px;color:${PROTOTYPE_COLORS.textSecondary};margin-top:6px;">Stage: ${escapeHtml(summary?.blockingStage ?? "n/a")}</div>
      <div style="font-size:13px;color:${PROTOTYPE_COLORS.textSecondary};margin-top:4px;">Reason: ${escapeHtml(summary?.blockingReason ?? "No blocking reason recorded.")}</div>
      ${control.error ? `<div style="font-size:13px;color:${PROTOTYPE_COLORS.danger};margin-top:8px;">${escapeHtml(control.error)}</div>` : ""}
    </div>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      ${canNormalizeBrief ? `<button data-action="production-brief-normalize" data-proposal-id="${escapeHtml(proposalId)}" style="cursor:pointer;padding:8px 14px;border-radius:8px;border:1px solid ${PROTOTYPE_COLORS.accent};background:transparent;color:${PROTOTYPE_COLORS.accent};font-family:'IBM Plex Mono',monospace;font-size:13px;" ${appState.productionControlBusy ? "disabled" : ""}>${data?.productionBrief ? "Refresh Production Brief" : "Create Production Brief"}</button>` : ""}
      ${canApproveForProduction ? `<button data-action="production-approve" data-proposal-id="${escapeHtml(proposalId)}" data-production-brief-id="${escapeHtml(data.productionBrief.productionBriefId)}" style="cursor:pointer;padding:8px 14px;border-radius:8px;border:1px solid ${PROTOTYPE_COLORS.accent};background:transparent;color:${PROTOTYPE_COLORS.accent};font-family:'IBM Plex Mono',monospace;font-size:13px;" ${appState.productionControlBusy ? "disabled" : ""}>Approve for Production</button>` : ""}
      ${canRejectForProduction ? `<button data-action="production-reject" data-proposal-id="${escapeHtml(proposalId)}" data-production-brief-id="${escapeHtml(data.productionBrief.productionBriefId)}" style="cursor:pointer;padding:8px 14px;border-radius:8px;border:1px solid ${PROTOTYPE_COLORS.danger};background:transparent;color:${PROTOTYPE_COLORS.danger};font-family:'IBM Plex Mono',monospace;font-size:13px;" ${appState.productionControlBusy ? "disabled" : ""}>Reject for Production</button>` : ""}
      ${canProduce ? `<button data-action="production-execute" data-proposal-id="${escapeHtml(proposalId)}" style="cursor:pointer;padding:8px 14px;border-radius:8px;border:1px solid ${PROTOTYPE_COLORS.accent};background:${PROTOTYPE_COLORS.accent};color:#05070a;font-family:'IBM Plex Mono',monospace;font-size:13px;" ${appState.productionControlBusy ? "disabled" : ""}>Produce</button>` : ""}
      ${summary?.overallStatus === "in-progress" ? `<div style="font-size:13px;color:${PROTOTYPE_COLORS.warning};">Production already in progress; no duplicate execution is exposed.</div>` : ""}
      ${summary?.overallStatus === "completed" ? `<div style="font-size:13px;color:${PROTOTYPE_COLORS.accent};">Production already completed.</div>` : ""}
      ${appState.productionBriefResult ? `<div style="font-size:13px;color:${PROTOTYPE_COLORS.textSecondary};">${escapeHtml(appState.productionBriefResult)}</div>` : ""}
    </div>
    <div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:12px;padding:10px 12px;">
      <div style="font-size:12px;letter-spacing:0.06em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;">Stage overview</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">
        ${stageEntries.map(([label, stageStatus]) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px;color:${PROTOTYPE_COLORS.textSecondary};"><span>${escapeHtml(label)}</span><span style="color:${productionStatusColor(stageStatus)};font-family:'IBM Plex Mono',monospace;text-transform:uppercase;">${escapeHtml(stageStatus)}</span></div>`).join("")}
      </div>
    </div>
    ${summary?.overallStatus === "completed" ? `<div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:12px;padding:10px 12px;">
      <div style="font-size:12px;letter-spacing:0.06em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;">Final Video</div>
      ${finalVideoHtml}
    </div>` : ""}
  </div>`;
}

// Renders only what GET /api/content-review and GET /api/publishing-queue actually returned.
// Read-only: this function never fetches, enqueues, or mutates anything itself. Combines the two
// real datasets to show eligibility/queued/rejected state without inventing any new state.
function renderPublishingQueuePanel(contentReview, publishingQueue, busyProposalId, preflightBusyEntryId) {
  if (contentReview.status === "error" || publishingQueue.status === "error") {
    return `<div style="font-size:16px;color:${PROTOTYPE_COLORS.textSecondary};">Publishing queue is currently unavailable.</div>`;
  }
  if (contentReview.status === "loading" || publishingQueue.status === "loading") {
    return `<div style="font-size:16px;color:${PROTOTYPE_COLORS.textTertiary};">Loading publishing queue\u2026</div>`;
  }

  const decidedProposals = (contentReview.proposals ?? []).filter((proposal) => proposal.status === "approved" || proposal.status === "rejected");
  if (decidedProposals.length === 0) {
    return `<div style="font-size:16px;color:${PROTOTYPE_COLORS.textTertiary};">No reviewed proposals yet.</div>`;
  }

  const entriesByProposal = new Map((publishingQueue.entries ?? []).map((entry) => [entry.proposalId, entry]));

  return decidedProposals
    .map((proposal) => {
      const queueEntry = entriesByProposal.get(proposal.proposalId);
      const isBusy = busyProposalId === proposal.proposalId;
      let statusLabel;
      let statusColor;
      let action = "";

      if (proposal.status === "rejected") {
        statusLabel = "rejected / not eligible";
        statusColor = PROTOTYPE_COLORS.danger;
      } else if (queueEntry) {
        statusLabel = `${queueEntry.status.replace("-", " ")} · ${queueEntry.status}`;
        statusColor = queueEntry.status === "published" ? PROTOTYPE_COLORS.accent : queueEntry.status === "failed" || queueEntry.status === "unknown-result" ? PROTOTYPE_COLORS.danger : PROTOTYPE_COLORS.accent;
        const isPreflightBusy = preflightBusyEntryId === queueEntry.queueEntryId;
        const isPublishBusy = appState.metricoolPublishBusyEntryId === queueEntry.queueEntryId;
        if (queueEntry.status === "queued") {
          const structuredResult = proposal.structuredResult ?? {};
          const hasInstagramMedia = String(structuredResult.platform ?? "").toLowerCase() === "instagram" && Array.isArray(structuredResult.media) && structuredResult.media.some((url) => typeof url === "string" && /^https:\/\//i.test(url));
          action = `<button data-action="metricool-preflight" data-queue-entry-id="${escapeHtml(queueEntry.queueEntryId)}" ${isPreflightBusy ? "disabled" : ""} style="margin-top:8px;cursor:pointer;padding:8px 14px;border-radius:8px;border:1px solid ${PROTOTYPE_COLORS.textSecondary};background:transparent;color:${PROTOTYPE_COLORS.textSecondary};font-family:'IBM Plex Mono',monospace;font-size:13px;">Check Metricool readiness (validation only)</button>${hasInstagramMedia ? `<button data-action="metricool-publish" data-queue-entry-id="${escapeHtml(queueEntry.queueEntryId)}" ${isPublishBusy ? "disabled" : ""} style="margin-top:8px;margin-left:8px;cursor:pointer;padding:8px 14px;border-radius:8px;border:1px solid ${PROTOTYPE_COLORS.accent};background:transparent;color:${PROTOTYPE_COLORS.accent};font-family:'IBM Plex Mono',monospace;font-size:13px;">Schedule via Metricool</button>` : `<div style="margin-top:8px;font-size:13px;color:${PROTOTYPE_COLORS.textSecondary};">Blocked: Instagram requires a real public media URL.</div>`}`;
        } else if (queueEntry.status === "publishing") {
          action = `<div style="margin-top:8px;font-size:13px;color:${PROTOTYPE_COLORS.warning};">Publishing request recorded. Awaiting persisted outcome.</div>`;
        } else if (queueEntry.status === "unknown-result") {
          action = `<div style="margin-top:8px;font-size:13px;color:${PROTOTYPE_COLORS.danger};">Unknown result: Novara cannot confirm whether Metricool created the post. No automatic retry.</div>`;
        } else if (queueEntry.status === "published") {
          action = `<div style="margin-top:8px;font-size:13px;color:${PROTOTYPE_COLORS.accent};">Published${queueEntry.publishExternalUuid ? ` · ${escapeHtml(queueEntry.publishExternalUuid)}` : ""}</div>`;
        } else if (queueEntry.status === "failed") {
          action = `<div style="margin-top:8px;font-size:13px;color:${PROTOTYPE_COLORS.danger};">Failed: ${escapeHtml(queueEntry.publishErrorReason ?? "Metricool rejected the request.")}</div>`;
        }
      } else {
        statusLabel = "approved \u00b7 eligible";
        statusColor = PROTOTYPE_COLORS.warning;
        action = `<button data-action="publishing-queue-enqueue" data-proposal-id="${escapeHtml(proposal.proposalId)}" ${isBusy ? "disabled" : ""} style="margin-top:8px;cursor:pointer;padding:8px 14px;border-radius:8px;border:1px solid ${PROTOTYPE_COLORS.accent};background:transparent;color:${PROTOTYPE_COLORS.accent};font-family:'IBM Plex Mono',monospace;font-size:13px;">Queue for publishing</button>`;
      }

      return `<div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:12px;padding:12px 16px;margin-bottom:10px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div style="font-size:13px;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;">${escapeHtml(proposal.proposalId)} \u00b7 ${escapeHtml(proposal.agentId ?? "A-014")}</div>
          <div style="font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:${statusColor};font-family:'IBM Plex Mono',monospace;">${escapeHtml(statusLabel)}</div>
        </div>
        ${queueEntry ? `<div style="margin-top:6px;font-size:13px;color:${PROTOTYPE_COLORS.textSecondary};">Queued at ${escapeHtml(queueEntry.createdAt)}</div>` : ""}
        ${action}
      </div>`;
    })
    .join("");
}

// Renders only what GET /api/metricool-status actually returned. Never shows "Ready" merely
// because the page loaded; only reflects the real, current server-reported state.
function renderMetricoolStatus(metricoolStatus) {
  const state = metricoolStatus?.state ?? "loading";
  if (state === "loading") {
    return `<div style="font-size:16px;color:${PROTOTYPE_COLORS.textTertiary};">Checking Metricool status\u2026</div>`;
  }
  if (state === "error") {
    return `<div style="font-size:16px;color:${PROTOTYPE_COLORS.textSecondary};">Metricool status is currently unavailable.</div>`;
  }

  const labels = {
    "not-configured": { text: "Not configured", color: PROTOTYPE_COLORS.textTertiary },
    unavailable: { text: "Connection failed / unavailable", color: PROTOTYPE_COLORS.danger },
    ready: { text: "Ready", color: PROTOTYPE_COLORS.accent },
  };
  const label = labels[state] ?? labels["not-configured"];

  return `<div style="display:flex;align-items:center;gap:10px;">
    <div style="width:9px;height:9px;border-radius:50%;background:${label.color};"></div>
    <div style="font-size:16px;color:${label.color};">${escapeHtml(label.text)}</div>
  </div>
  <div style="margin-top:6px;font-size:13px;color:${PROTOTYPE_COLORS.textSecondary};">${escapeHtml(metricoolStatus?.reason ?? "")}</div>`;
}

function generateSphere() {
  if (appState.sphere) {
    return appState.sphere;
  }

  let seed = 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const points = [];
  for (let i = 0; i < 320; i += 1) {
    const ang = rand() * Math.PI * 2;
    const rad = Math.sqrt(rand()) * 100;
    const depth = rand();
    points.push({
      x: 100 + Math.cos(ang) * rad,
      y: 100 + Math.sin(ang) * rad,
      r: 0.7 + depth * 1.4,
      o: 0.34 + depth * 0.52,
      orbitAngle: ang,
      orbitRadius: rad,
      orbitPhase: rand() * Math.PI * 2,
      orbitSpeed: 0.018 + rand() * 0.014,
      orbitWobble: 0.8 + rand() * 1.4,
    });
  }

  const edges = [];
  const seen = new Set();
  points.forEach((point, i) => {
    const dists = points
      .map((candidate, j) => ({ j, d: j === i ? Infinity : Math.hypot(point.x - candidate.x, point.y - candidate.y) }))
      .sort((a, b) => a.d - b.d);

    for (let k = 0; k < 6; k += 1) {
      const { j, d } = dists[k];
      if (d < 18) {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (!seen.has(key)) {
          seen.add(key);
          edges.push({ i, j });
        }
      }
    }
  });

  appState.sphere = { points, edges };
  return appState.sphere;
}

async function requestHermesAnswer(question) {
  const response = await fetch("/api/hermes/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });

  if (!response.ok) {
    throw new Error("Hermes request failed");
  }

  const payload = await response.json();
  return String(payload?.answer ?? "Hermes could not provide a response.");
}

async function runVoiceInteraction(question) {
  if (appState.voiceBusy) {
    return;
  }

  const prompt = String(question ?? "").trim();
  if (!prompt) {
    voiceController.setTranscript("Please type a message for Hermes.");
    return;
  }

  appState.voiceBusy = true;
  setAudioReactiveLevel(0);

  try {
    voiceController.thinking();
    voiceController.setTranscript("Thinking...");

    let answer = "";
    try {
      answer = await requestHermesAnswer(prompt);
    } catch {
      voiceController.setTranscript("Hermes error: unable to process request.");
      return;
    }

    voiceController.setTranscript(answer);
    voiceController.speaking(1);

    const provider = appState.voiceProvider ?? createNoopVoiceProvider();
    try {
      await provider.speak(answer);
    } catch {
      voiceController.setTranscript("Voice error: unable to play audio.");
    }
  } finally {
    setAudioReactiveLevel(0);
    appState.voiceBusy = false;
    voiceController.idle();
  }
}

function applySphereReactiveStyle() {
  const root = document.querySelector('[data-sphere-root="true"]');
  const glow = document.querySelector('[data-sphere-glow="true"]');
  const core = document.querySelector('[data-sphere-core="true"]');
  const network = document.querySelector('[data-sphere-network="true"]');
  if (!root || !glow || !core || !network) {
    return;
  }

  const mode = appState.voice?.mode ?? VOICE_MODES.IDLE;
  const modeStyle = VOICE_STYLE[mode] ?? VOICE_STYLE.idle;

  if (mode !== VOICE_MODES.SPEAKING) {
    root.style.transform = "scale(1)";
    root.style.filter = "none";
    glow.style.opacity = String(modeStyle.baseGlow);
    glow.style.filter = "blur(34px)";
    core.style.filter = `brightness(${modeStyle.heartBrightness})`;
    core.style.transform = "translate3d(0,0,0)";
    network.style.animationDuration = "";
    return;
  }

  const level = clamp01(appState.audioReactiveLevel);
  const eased = level * level * (3 - 2 * level);

  const scale = 1 + eased * 0.028;
  const glowOpacity = modeStyle.baseGlow + eased * 0.22;
  const glowBlur = 34 + eased * 10;
  const glowSpread = 34 + eased * 12;
  const glowAlpha = 0.26 + eased * 0.15;
  const brightness = modeStyle.heartBrightness + eased * 0.2;
  const driftY = -(eased * 1.5);
  const breathDuration = Math.max(0.38, 0.62 - eased * 0.2);

  root.style.transform = `scale(${scale.toFixed(4)})`;
  root.style.filter = `drop-shadow(0 0 ${(18 + eased * 20).toFixed(1)}px rgba(127,179,255,${(0.08 + eased * 0.13).toFixed(3)}))`;
  glow.style.opacity = glowOpacity.toFixed(3);
  glow.style.filter = `blur(${glowBlur.toFixed(1)}px)`;
  glow.style.boxShadow = `0 0 120px ${glowSpread.toFixed(1)}px rgba(127,179,255,${glowAlpha.toFixed(3)})`;
  core.style.filter = `brightness(${brightness.toFixed(3)})`;
  core.style.transform = `translate3d(0,${driftY.toFixed(2)}px,0)`;
  network.style.animationDuration = `${breathDuration.toFixed(3)}s`;
}

function scheduleSpherePulse(now) {
  appState.sphereNextPulseAt = now + 18000 + Math.random() * 22000;
  appState.spherePulseStartedAt = 0;
  appState.spherePulseDuration = 0;
}

function ensureSphereIdleAnimation() {
  if (appState.sphereAnimationFrame != null || document.hidden || appState.voice?.mode !== VOICE_MODES.IDLE) {
    return;
  }

  const now = performance.now();
  if (!appState.sphereAnimationStartedAt) {
    appState.sphereAnimationStartedAt = now;
    scheduleSpherePulse(now);
  }

  appState.sphereAnimationFrame = requestAnimationFrame(animateSphereIdle);
}

function animateSphereIdle(now) {
  appState.sphereAnimationFrame = null;

  if (document.hidden || appState.voice?.mode !== VOICE_MODES.IDLE) {
    return;
  }

  if (now - appState.sphereLastAnimationFrame < 1000 / 30) {
    ensureSphereIdleAnimation();
    return;
  }
  appState.sphereLastAnimationFrame = now;

  const root = document.querySelector('[data-sphere-root="true"]');
  const network = document.querySelector('[data-sphere-network="true"]');
  if (!root || !network) {
    return;
  }

  if (!appState.sphereAnimationNodes || appState.sphereAnimationNodes.root !== root) {
    appState.sphereAnimationNodes = {
      root,
      network,
      particles: [...root.querySelectorAll("[data-sphere-particle]")],
    };
  }

  const elapsed = (now - appState.sphereAnimationStartedAt) / 1000;
  const breath = Math.sin((elapsed * Math.PI * 2) / 8.6 + Math.sin(elapsed / 17) * 0.22);
  const orbit = elapsed * 2.8 + Math.sin(elapsed / 21) * 1.8;

  if (!appState.spherePulseStartedAt && now >= appState.sphereNextPulseAt) {
    appState.spherePulseStartedAt = now;
    appState.spherePulseDuration = 3200 + Math.random() * 1200;
  }

  let pulse = 0;
  if (appState.spherePulseStartedAt) {
    const progress = (now - appState.spherePulseStartedAt) / appState.spherePulseDuration;
    if (progress >= 1) {
      scheduleSpherePulse(now);
    } else {
      pulse = Math.sin(progress * Math.PI);
    }
  }

  const scale = 1 + breath * 0.006 + pulse * 0.009;
  root.style.transform = `scale(${scale.toFixed(4)})`;
  network.style.transform = `rotate(${orbit.toFixed(2)}deg) scale(${(1 + breath * 0.004 + pulse * 0.006).toFixed(4)})`;

  appState.sphereAnimationNodes.particles.forEach((particle, index) => {
    const point = appState.sphere.points[index];
    if (!point) {
      return;
    }

    const particleTime = elapsed * point.orbitSpeed + point.orbitPhase;
    const radius = point.orbitRadius + Math.sin(elapsed / 13 + point.orbitPhase) * point.orbitWobble;
    const angle = point.orbitAngle + particleTime;
    particle.setAttribute("cx", (100 + Math.cos(angle) * radius).toFixed(1));
    particle.setAttribute("cy", (100 + Math.sin(angle) * radius).toFixed(1));
  });

  ensureSphereIdleAnimation();
}

function renderSpiderweb(layout, voiceMode) {
  const functionsByDepartmentId = new Map(layout.functions.map((item) => [item.departmentId, item]));
  const agentsByDepartmentId = new Map();
  layout.agents.forEach((agent) => {
    const list = agentsByDepartmentId.get(agent.departmentId) ?? [];
    list.push(agent);
    agentsByDepartmentId.set(agent.departmentId, list);
  });
  const style = VOICE_STYLE[voiceMode] ?? VOICE_STYLE.idle;
  const focusDepartmentId = appState.spiderwebFocusDepartmentId;

  return `
    <div data-action="sphere-click" data-sphere-root="true" aria-label="Hermes sphere" role="button" tabindex="0" style="position:relative;width:448px;height:448px;flex:0 0 auto;cursor:pointer;background:none;border:none;padding:0;display:block;outline:none;overflow:visible;animation:${style.edgeAnim};transition:transform 120ms linear,filter 150ms ease-out;">
      <div data-sphere-glow="true" style="position:absolute;inset:-34px;border-radius:50%;box-shadow:0 0 120px 34px rgba(127,179,255,0.26);opacity:${style.baseGlow};filter:blur(34px);animation:${style.edgeAnim};transition:opacity 120ms linear,filter 120ms linear,box-shadow 140ms linear;"></div>
      <div data-sphere-network="true" style="position:absolute;inset:0;pointer-events:none;animation:${style.breatheAnim};"></div>
      <div style="position:absolute;inset:0;pointer-events:none;">
        ${layout.departments.map((department) => {
          const departmentColor = SPIDERWEB_HEALTH_COLORS[department.health] ?? SPIDERWEB_HEALTH_COLORS.neutral;
          const focused = !focusDepartmentId || focusDepartmentId === department.id;
          const agents = agentsByDepartmentId.get(department.id) ?? [];
          const functionNode = functionsByDepartmentId.get(department.id);
          const departmentNameWidth = Math.max(114, Math.min(150, 88 + department.label.length * 2.2));
          const functionNameWidth = Math.max(114, Math.min(150, 84 + department.functionLabel.length * 2.0));
          return `
            ${renderSpiderwebLine(layout.center.x, layout.center.y, department.point.x, department.point.y, departmentColor, focused ? 0.36 : 0.1, 1)}
            ${renderSpiderwebLine(department.point.x, department.point.y, functionNode.point.x, functionNode.point.y, "rgba(127,179,255,0.38)", focused ? 0.8 : 0.18, 0.8)}
            ${agents.map((agent) => renderSpiderwebLine(functionNode.point.x, functionNode.point.y, agent.point.x, agent.point.y, "rgba(127,179,255,0.22)", focused ? 0.62 : 0.12, 0.7)).join("")}
            <button data-action="spiderweb-focus" data-department-id="${escapeHtml(department.id)}" aria-label="Focus ${escapeHtml(department.label)}" title="${escapeHtml(department.label)}" style="position:absolute;left:${department.point.x - departmentNameWidth / 2}px;top:${department.point.y - 16}px;width:${departmentNameWidth}px;height:32px;border-radius:999px;border:1px solid ${departmentColor};background:rgba(0,0,0,0.14);color:${departmentColor};pointer-events:auto;opacity:${focused ? 1 : 0.22};padding:0 10px;font:12px 'IBM Plex Mono',monospace;letter-spacing:0.06em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;z-index:${focused ? 3 : 1};">${escapeHtml(department.label)}</button>
            <div style="position:absolute;left:${functionNode.point.x - functionNameWidth / 2}px;top:${functionNode.point.y - 16}px;width:${functionNameWidth}px;height:32px;border-radius:999px;border:1px solid rgba(127,179,255,0.34);background:rgba(255,255,255,0.025);pointer-events:none;opacity:${focused ? 1 : 0.22};display:flex;align-items:center;justify-content:center;padding:0 10px;box-sizing:border-box;z-index:${focused ? 3 : 1};overflow:hidden;">
              <span style="font:11px 'IBM Plex Mono',monospace;letter-spacing:0.08em;color:${PROTOTYPE_COLORS.textPrimary};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(department.functionLabel)}</span>
            </div>
            ${agents.map((agent) => {
              const agentColor = SPIDERWEB_HEALTH_COLORS[agent.health] ?? SPIDERWEB_HEALTH_COLORS.neutral;
              const agentName = agentDisplayName(agent.agent);
              const agentId = agentDisplayId(agent.agent);
              const agentLabelWidth = Math.max(118, Math.min(150, 108 + `${agentId} ${agentName}`.length * 1.6));
              return `
                <div style="position:absolute;left:${agent.point.x - agentLabelWidth / 2}px;top:${agent.point.y - 15}px;width:${agentLabelWidth}px;height:30px;border-radius:999px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.14);backdrop-filter:blur(6px);pointer-events:none;opacity:${focused ? 1 : 0.38};display:flex;align-items:center;gap:6px;padding:0 9px;box-sizing:border-box;z-index:${focused ? 3 : 1};overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">
                  <span style="width:6px;height:6px;border-radius:50%;background:${agentColor};flex:0 0 auto;"></span>
                  <span style="font:10px 'IBM Plex Mono',monospace;color:${PROTOTYPE_COLORS.textPrimary};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(agentId)}</span>
                  <span style="font:10px 'IBM Plex Mono',monospace;color:${PROTOTYPE_COLORS.textSecondary};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(agentName)}</span>
                </div>
              `;
            }).join("")}
          `;
        }).join("")}
      </div>
      <button data-action="sphere-click" data-sphere-core="true" aria-label="Return to overview or speak to Hermes" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:148px;height:148px;border-radius:50%;border:1px solid rgba(127,179,255,0.32);background:radial-gradient(circle at 50% 42%, rgba(255,255,255,0.09), rgba(255,255,255,0.015) 62%, rgba(0,0,0,0.16) 100%);color:${PROTOTYPE_COLORS.textPrimary};font-family:'IBM Plex Mono',monospace;cursor:pointer;pointer-events:auto;box-shadow:0 0 70px rgba(127,179,255,0.12), inset 0 0 24px rgba(127,179,255,0.08);backdrop-filter:blur(8px);">
        <div style="font-size:22px;letter-spacing:0.08em;">NOVARA</div>
        <div style="margin-top:6px;font-size:12px;letter-spacing:0.18em;color:${PROTOTYPE_COLORS.textTertiary};">CEO</div>
        ${focusDepartmentId ? `<div style="margin-top:8px;font-size:11px;color:${PROTOTYPE_COLORS.accent};">Return to overview</div>` : `<div style="margin-top:8px;font-size:11px;color:${PROTOTYPE_COLORS.textTertiary};">Speak / focus</div>`}
      </button>
    </div>
  `;
}

function render() {
  if (!appState.snapshot) {
    return;
  }

  const snapshot = normalizeSnapshot(appState.snapshot);
  const metrics = buildMetrics(snapshot);
  const attentionItems = buildAttentionItems(snapshot);
  const agents = snapshot.agents ?? [];
  const agentNames = snapshot.commandInterface.agentNames?.length
    ? snapshot.commandInterface.agentNames
    : agents.slice(0, 6).map((agent) => agent.name ?? agent.id ?? "Agent");
  const activeAgentNames = agentNames.map((name) => escapeHtml(name));
  const agentDetails = agents.map((agent) => ({
    name: escapeHtml(agent.name ?? agent.id ?? "Agent"),
    status: escapeHtml(agent.status ?? "unknown"),
    authorityLevel: escapeHtml(agent.authorityLevel ?? "unknown"),
  }));
  const goal = snapshot.commandInterface.monthlyGoal;
  const updatedAt = snapshot.generatedAt ? new Date(snapshot.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "LIVE";
  const voiceMode = appState.voice?.mode ?? VOICE_MODES.IDLE;
  const currently = snapshot.commandInterface.currentNext.currently;
  const next = snapshot.commandInterface.currentNext.next;
  const autonomy = snapshot.commandInterface.autonomy ?? { status: "Operational", level: "2", percent: 42 };
  const hasMonthlyGoal = Boolean(goal?.configured && goal.current != null && goal.target != null && goal.progress != null);
  const health = describeHealth(appState.health);
  const liveElevenLabsKey = document.querySelector('[data-input="elevenlabs-api-key"]')?.value ?? "";
  const liveMetricoolKey = document.querySelector('[data-input="metricool-api-key"]')?.value ?? "";
  const liveRevenueCatKey = document.querySelector('[data-input="revenuecat-api-key"]')?.value ?? "";
  const views = ["dashboard", "content", "knowledge", "production", "publishing", "connections", "organization"];
  const nav = views.map((view) => `<button data-action="nav-${view}" style="cursor:pointer;border:0;background:${appState.activeView === view ? "rgba(126,224,255,0.14)" : "transparent"};color:${appState.activeView === view ? PROTOTYPE_COLORS.accent : PROTOTYPE_COLORS.textTertiary};padding:7px 9px;border-radius:7px;font:12px 'IBM Plex Mono',monospace;text-transform:uppercase;">${view}</button>`).join("");
  const contentView = `<div style="padding:20px 36px;display:grid;gap:16px;"><div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:16px;padding:16px 20px;background:${PROTOTYPE_COLORS.bgPanel};"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;"><div><div style="font:16px 'IBM Plex Mono',monospace;letter-spacing:.08em;color:${PROTOTYPE_COLORS.textTertiary};">CONTENT REVIEW ACCESS</div><div style="margin-top:7px;color:${PROTOTYPE_COLORS.textSecondary};">${appState.contentReviewAccess.configured ? "Configured" : "Not configured"}</div></div><button data-action="content-review-access-configure">${appState.contentReviewAccess.configured ? "Change Review Access" : "Configure Review Access"}</button></div></div><div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:16px;padding:16px 20px;background:${PROTOTYPE_COLORS.bgPanel};"><div style="font-size:16px;letter-spacing:0.08em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;margin-bottom:12px;">CONTENT REVIEW</div><div style="display:grid;gap:7px;margin-bottom:14px;"><textarea data-input="content-source" placeholder="Content topic or source text">${escapeHtml(appState.contentDraft.content)}</textarea><select data-input="content-platform"><option ${appState.contentDraft.platform === "TikTok" ? "selected" : ""}>TikTok</option><option ${appState.contentDraft.platform === "Instagram Reels" ? "selected" : ""}>Instagram Reels</option><option ${appState.contentDraft.platform === "YouTube Shorts" ? "selected" : ""}>YouTube Shorts</option></select><input data-input="content-goal" value="${escapeHtml(appState.contentDraft.goal)}" placeholder="Optional content goal"><button data-action="content-proposal-create">Create draft for review</button></div>${renderContentReviewPanel(appState.contentReview, appState.contentReviewBusyProposalId)}</div></div>`;
  const knowledgeView = `<div style="padding:20px 36px;">${renderInstitutionalKnowledgePanel()}</div>`;
  const productionView = `<div style="padding:20px 36px;display:grid;gap:16px;"><div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:16px;padding:16px 20px;background:${PROTOTYPE_COLORS.bgPanel};"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;"><div><div style="font:16px 'IBM Plex Mono',monospace;letter-spacing:.08em;color:${PROTOTYPE_COLORS.textTertiary};">PRODUCTION ACCESS</div><div style="margin-top:7px;color:${PROTOTYPE_COLORS.textSecondary};">${appState.productionAccess.configured ? "Configured" : "Not configured"}</div></div><button data-action="production-access-configure">${appState.productionAccess.configured ? "Change Production Access" : "Configure Production Access"}</button></div></div>${renderProductionControlPanel()}</div>`;
  const publishingView = `<div style="padding:20px 36px;display:grid;gap:16px;"><div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:16px;padding:16px 20px;background:${PROTOTYPE_COLORS.bgPanel};"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;"><div><div style="font:16px 'IBM Plex Mono',monospace;letter-spacing:.08em;color:${PROTOTYPE_COLORS.textTertiary};">PUBLISHING ACCESS</div><div style="margin-top:7px;color:${PROTOTYPE_COLORS.textSecondary};">${appState.publishingAccess.configured ? "Configured" : "Not configured"}</div></div><button data-action="publishing-access-configure">${appState.publishingAccess.configured ? "Change Publishing Access" : "Configure Publishing Access"}</button></div></div><div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:16px;padding:16px 20px;background:${PROTOTYPE_COLORS.bgPanel};"><div style="font-size:16px;letter-spacing:0.08em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;margin-bottom:12px;">PUBLISHING QUEUE</div>${renderPublishingQueuePanel(appState.contentReview, appState.publishingQueue, appState.publishingQueueBusyProposalId, appState.metricoolPreflightBusyEntryId)}</div></div>`;
  const connectionCard = (name, state, action, details = "") => `<div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:16px;padding:16px 20px;background:${PROTOTYPE_COLORS.bgPanel};"><div style="font-size:16px;letter-spacing:0.08em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;margin-bottom:12px;">${name}</div><div style="color:${PROTOTYPE_COLORS.textSecondary};">${state.configured ? state.test === "successful" ? "Test successful" : state.test === "failed" ? "Test failed" : "Configured" : "Not configured"}</div>${details}${state.httpStatus ? `<div style="margin-top:6px;font:13px 'IBM Plex Mono',monospace;color:${PROTOTYPE_COLORS.textTertiary};">HTTP: ${escapeHtml(String(state.httpStatus))}</div>` : ""}${state.reason ? `<div style="margin-top:4px;font-size:14px;line-height:1.5;color:${PROTOTYPE_COLORS.textTertiary};">Reason: ${escapeHtml(state.reason)}</div>` : ""}<div style="display:flex;gap:8px;margin-top:12px;"><button data-action="${action}-configure">Configure</button><button data-action="${action}-test">Test Connection</button></div></div>`;
  const metricoolApiDetails = `<div style="margin-top:8px;display:grid;gap:3px;font:13px 'IBM Plex Mono',monospace;color:${PROTOTYPE_COLORS.textTertiary};"><div>API Key: ${appState.metricoolConnection.configured ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022configured" : "not configured"}</div><div>User ID: ${escapeHtml(appState.metricoolConnection.userId || "\u2014")}</div><div>Blog ID: ${escapeHtml(appState.metricoolConnection.blogId || "\u2014")}</div></div>`;
  const revenueCatDetails = `<div style="margin-top:8px;display:grid;gap:3px;font:13px 'IBM Plex Mono',monospace;color:${PROTOTYPE_COLORS.textTertiary};"><div>API Key: ${appState.revenueCatConnection.configured ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022configured" : "not configured"}</div><div>Project: ${escapeHtml(appState.revenueCatConnection.projectName || "\u2014")}</div><div>Project ID: ${escapeHtml(appState.revenueCatConnection.projectId || "\u2014")}</div><div>Connection: ${appState.revenueCatConnection.test === "successful" ? "Connected" : "Not connected"}</div></div>`;
  const connectionsView = `<div style="padding:20px 36px;display:grid;gap:16px;">${connectionCard("OPENAI", appState.openAiConnection, "openai")}${connectionCard("ELEVENLABS", appState.elevenLabsConnection, "elevenlabs")}<div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:16px;padding:16px 20px;background:${PROTOTYPE_COLORS.bgPanel};"><div style="font-size:16px;letter-spacing:0.08em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;margin-bottom:12px;">METRICOOL</div>${renderMetricoolStatus(appState.metricoolStatus)}<div style="margin-top:16px;font-size:14px;color:${PROTOTYPE_COLORS.textSecondary};">Metricool readiness and publishing use separate existing credential contracts.</div></div>${connectionCard("METRICOOL API", appState.metricoolConnection, "metricool-api", metricoolApiDetails)}${connectionCard("REVENUECAT", appState.revenueCatConnection, "revenuecat", revenueCatDetails)}</div>`;
  const organizationView = `<div style="padding:20px 36px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;"><div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:16px;padding:16px 20px;background:${PROTOTYPE_COLORS.bgPanel};"><div style="font-size:16px;letter-spacing:0.08em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;margin-bottom:12px;">ORGANIZATION</div>${agentDetails.map((agent) => `<div style="display:flex;justify-content:space-between;padding:8px 0;color:${PROTOTYPE_COLORS.textSecondary};"><span>${agent.name}</span><span>${agent.status} · ${agent.authorityLevel}</span></div>`).join("")}</div><div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:16px;padding:16px 20px;background:${PROTOTYPE_COLORS.bgPanel};"><div style="font-size:16px;letter-spacing:0.08em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;margin-bottom:12px;">TRUST & REVIEW</div>${renderTrustReviewPanel(appState.trustReview)}</div></div>`;

  document.body.innerHTML = `
    <div class="app-shell" style="background:${PROTOTYPE_COLORS.bgPage};color:${PROTOTYPE_COLORS.textPrimary};font-family:'Inter',sans-serif;display:flex;flex-direction:column;overflow:visible;position:relative;box-sizing:border-box;width:100vw;min-height:100vh;">
      <div style="flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px 24px;padding:18px 48px;border-bottom:1px solid ${PROTOTYPE_COLORS.borderSubtle};background:rgba(255,255,255,0.01);">
        <div style="display:flex;align-items:center;gap:21px;flex-wrap:wrap;">
          <div style="font-size:25px;font-weight:600;letter-spacing:0.08em;">NOVARA</div>
          <div style="width:1px;height:24px;background:${PROTOTYPE_COLORS.borderSubtle};"></div>
          <div style="font-size:19px;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;letter-spacing:0.05em;">HERMES</div>
          <div style="width:1px;height:24px;background:${PROTOTYPE_COLORS.borderSubtle};"></div>
          <div style="display:flex;align-items:center;gap:9px;font-family:'IBM Plex Mono',monospace;font-size:16px;color:${PROTOTYPE_COLORS.textTertiary};white-space:nowrap;">
            <div style="width:9px;height:9px;border-radius:50%;background:${PROTOTYPE_COLORS.accent};animation:edgeIdle 2.4s ease-in-out infinite;"></div>
            <span>LIVE · ${escapeHtml(updatedAt)}</span>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:21px;font-family:'IBM Plex Mono',monospace;font-size:18px;color:${PROTOTYPE_COLORS.textSecondary};position:relative;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:9px;white-space:nowrap;">
            <div style="width:9px;height:9px;border-radius:50%;background:${health.color};"></div>
            <span style="font-size:16px;color:${health.color};">${escapeHtml(health.label)}</span>
          </div>
          <div style="width:1px;height:20px;background:${PROTOTYPE_COLORS.borderSubtle};"></div>
          <div style="white-space:nowrap;">${escapeHtml(String(snapshot.commandInterface.agentCount ?? agents.length))} agents active</div>
          <div style="width:1px;height:20px;background:${PROTOTYPE_COLORS.borderSubtle};"></div>
          <div style="font-size:16px;color:${PROTOTYPE_COLORS.textTertiary};white-space:nowrap;">AUTONOMY · LVL ${escapeHtml(String(autonomy.level ?? "2"))}</div>
          <div style="font-size:16px;color:${PROTOTYPE_COLORS.textTertiary};white-space:nowrap;">SYSTEM · ${escapeHtml(String(autonomy.status ?? "Operational"))}</div>
          <div style="display:flex;align-items:center;gap:10px;padding:9px 16px;border-radius:999px;border:1px solid ${PROTOTYPE_COLORS.borderSubtle};background:rgba(255,255,255,0.02);color:${PROTOTYPE_COLORS.textPrimary};white-space:nowrap;">
            <div style="width:10px;height:10px;border-radius:999px;background:${PROTOTYPE_COLORS.textTertiary};box-shadow:0 0 10px rgba(255,255,255,0.12);"></div>
            <span style="font-family:'IBM Plex Mono',monospace;font-size:13px;letter-spacing:0.04em;">Connect ElevenLabs</span>
          </div>
        </div>
      </div>

      <div style="flex:0 0 auto;display:flex;gap:4px;flex-wrap:wrap;padding:8px 36px;border-bottom:1px solid ${PROTOTYPE_COLORS.borderSubtle};background:rgba(255,255,255,0.01);">${nav}</div>

      ${appState.activeView === "dashboard" ? `<div style="flex:1 1 auto;display:grid;grid-template-columns:405px 1fr 405px;gap:24px;padding:20px 36px 15px;min-height:0;overflow-y:auto;">
        <div style="display:flex;flex-direction:column;gap:9px;height:fit-content;">
          <div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:16px;padding:14px 20px;background:${PROTOTYPE_COLORS.bgPanel};display:flex;flex-direction:column;gap:11px;">
            <div style="font-size:16px;letter-spacing:0.08em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;">COMPANY PULSE</div>
            <div style="display:flex;flex-direction:column;gap:9px;">
              ${metrics.map((metric) => `<div style="display:grid;grid-template-columns:160px 100px 1fr;align-items:baseline;"><div style="font-size:14px;letter-spacing:0.04em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;">${escapeHtml(metric.label)}</div><div style="font-size:21px;font-family:'IBM Plex Mono',monospace;color:${PROTOTYPE_COLORS.textPrimary};">${escapeHtml(metric.value)}</div><div style="font-size:14px;font-family:'IBM Plex Mono',monospace;color:${PROTOTYPE_COLORS.textTertiary};">${metric.arrow ? `${escapeHtml(metric.arrow)} ` : ""}${metric.growth ? escapeHtml(metric.growth) : ""}</div></div>`).join("")}
            </div>
          </div>

          <div style="border:1px solid ${attentionItems.length ? PROTOTYPE_COLORS.danger : PROTOTYPE_COLORS.borderSubtle};border-radius:16px;padding:14px 20px;background:${PROTOTYPE_COLORS.bgPanel};display:flex;flex-direction:column;gap:12px;">
            <div style="font-size:15px;letter-spacing:0.08em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;">NEEDS YOUR ATTENTION</div>
            ${attentionItems.length ? attentionItems.map((item) => `<div style="display:flex;align-items:flex-start;gap:12px;"><div style="width:10px;height:10px;border-radius:50%;background:${escapeHtml(item.color)};margin-top:6px;flex:0 0 auto;"></div><div><div style="font-size:14px;letter-spacing:0.06em;color:${escapeHtml(item.color)};font-family:'IBM Plex Mono',monospace;">${escapeHtml(item.category)}</div><div style="font-size:19px;color:${PROTOTYPE_COLORS.textPrimary};margin-top:2px;">${escapeHtml(item.title)}</div><div style="font-size:16px;color:${PROTOTYPE_COLORS.textSecondary};margin-top:2px;">${escapeHtml(item.subtitle)}</div></div></div>`).join("") : `<div style="font-size:19px;color:${PROTOTYPE_COLORS.textTertiary};line-height:1.4;">No items requiring attention</div>`}
          </div>

          <div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:16px;padding:14px 20px;background:${PROTOTYPE_COLORS.bgPanel};display:flex;flex-direction:column;gap:12px;">
            <div>
              <div style="font-size:14px;letter-spacing:0.08em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;">CURRENTLY</div>
              <div style="font-size:19px;color:${PROTOTYPE_COLORS.textPrimary};margin-top:2px;">${escapeHtml(currently ?? "No active operation")}</div>
            </div>
            <div>
              <div style="font-size:14px;letter-spacing:0.08em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;">NEXT</div>
              <div style="font-size:19px;color:${PROTOTYPE_COLORS.textSecondary};margin-top:2px;">${escapeHtml(next ?? "No next action")}</div>
            </div>
          </div>
        </div>

        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;min-width:0;min-height:0;">
          <div style="height:18px;flex:0 0 auto;"></div>
          ${renderSpiderweb(layoutSpiderweb(snapshot), voiceMode)}
          <div style="width:100%;max-width:630px;text-align:center;font-size:20px;color:${PROTOTYPE_COLORS.textPrimary};line-height:1.4;min-height:30px;">${escapeHtml(appState.voice?.transcript ?? "")}</div>
          <input value="${escapeHtml(appState.queryDraft)}" placeholder="Type a message to Hermes" style="width:100%;max-width:540px;background:transparent;border:none;border-bottom:1px solid ${PROTOTYPE_COLORS.borderSubtle};padding:9px 6px;color:${PROTOTYPE_COLORS.textSecondary};font-size:19px;font-family:'Inter',sans-serif;outline:none;text-align:center;" data-input="hermes-draft" ${appState.voiceBusy ? "disabled" : ""} />
        </div>

        <div style="display:flex;flex-direction:column;gap:9px;height:fit-content;">
          <div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:16px;padding:24px 27px;background:${PROTOTYPE_COLORS.bgPanel};display:flex;flex-direction:column;gap:18px;transition:border-color .5s ease;">
            <div style="font-size:16px;letter-spacing:0.08em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;">${escapeHtml(String(snapshot.commandInterface.agentCount ?? agents.length))} AGENTS ACTIVE</div>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${agentDetails.length
                ? agentDetails
                    .map(
                      (agent) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13px;color:${PROTOTYPE_COLORS.textSecondary};">
                        <div style="display:flex;align-items:center;gap:7px;"><div style="width:8px;height:8px;border-radius:50%;background:${PROTOTYPE_COLORS.accent};"></div>${agent.name}</div>
                        <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:${PROTOTYPE_COLORS.textTertiary};white-space:nowrap;">${agent.status} · ${agent.authorityLevel}</div>
                      </div>`,
                    )
                    .join("")
                : activeAgentNames.map((name, index) => `<div style="display:flex;align-items:center;gap:7px;font-size:13px;color:${PROTOTYPE_COLORS.textSecondary};"><div style="width:8px;height:8px;border-radius:50%;background:${index % 2 === 0 ? PROTOTYPE_COLORS.accent : PROTOTYPE_COLORS.textTertiary};"></div>${name}</div>`).join("")}
            </div>
            <div style="font-size:19px;color:${PROTOTYPE_COLORS.textSecondary};line-height:1.45;max-width:300px;">The organization is active. Open a name to inspect it.</div>
            <div style="font-size:19px;color:${PROTOTYPE_COLORS.accent};cursor:pointer;margin-top:4px;">View organization →</div>
          </div>

          <div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:16px;padding:14px 20px;background:${PROTOTYPE_COLORS.bgPanel};display:flex;flex-direction:column;gap:12px;transition:border-color .5s ease;">
            <div style="font-size:15px;letter-spacing:0.08em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;">TRUST & REVIEW</div>
            ${renderTrustReviewPanel(appState.trustReview)}
          </div>
        </div>
      </div>`
      : appState.activeView === "content" ? contentView : appState.activeView === "knowledge" ? knowledgeView : appState.activeView === "production" ? productionView : appState.activeView === "publishing" ? publishingView : appState.activeView === "connections" ? connectionsView : organizationView}
    </div>
  `;

  appState.sphereAnimationNodes = null;
  bindEvents();
  applySphereReactiveStyle();
  if (voiceMode === VOICE_MODES.IDLE) {
    ensureSphereIdleAnimation();
  }
}

function bindEvents() {
  const draftInput = document.querySelector('[data-input="hermes-draft"]');
  if (draftInput) {
    draftInput.addEventListener("input", (event) => {
      appState.queryDraft = event.target?.value ?? "";
    });

    draftInput.addEventListener("keydown", async (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        await runVoiceInteraction(appState.queryDraft);
      }
    });
  }

  const productionProposalSelect = document.querySelector("[data-production-proposal-select]");
  if (productionProposalSelect) {
    productionProposalSelect.addEventListener("change", (event) => {
      const nextValue = event.target?.value ?? "";
      appState.productionControl = { ...appState.productionControl, proposalId: nextValue, status: nextValue ? "idle" : "idle" };
      if (nextValue) {
        loadProductionStatus(nextValue).catch((error) => {
          appState.productionControl = { ...appState.productionControl, status: "error", error: error?.message || "Production status request failed." };
          render();
        });
      }
    });
  }

  document.querySelectorAll('[data-input="content-source"], [data-input="content-goal"], [data-input="content-platform"]').forEach((input) => {
    const key = input.getAttribute("data-input") === "content-source" ? "content" : input.getAttribute("data-input") === "content-goal" ? "goal" : "platform";
    input.addEventListener(key === "platform" ? "change" : "input", (event) => { appState.contentDraft[key] = event.target?.value ?? ""; });
  });
  document.querySelectorAll('[data-input="elevenlabs-voice-id"], [data-input="elevenlabs-model-id"]').forEach((input) => {
    const key = input.getAttribute("data-input") === "elevenlabs-voice-id" ? "voiceId" : "modelId";
    input.addEventListener("input", (event) => { appState.elevenLabsDraft[key] = event.target?.value ?? ""; });
  });
  document.querySelectorAll('[data-input="metricool-user-id"], [data-input="metricool-blog-id"]').forEach((input) => {
    const key = input.getAttribute("data-input") === "metricool-user-id" ? "userId" : "blogId";
    input.addEventListener("input", (event) => { appState.metricoolDraft[key] = event.target?.value ?? ""; });
  });
  const revenueCatProjectInput = document.querySelector('[data-input="revenuecat-project-id"]');
  if (revenueCatProjectInput) {
    revenueCatProjectInput.addEventListener("change", (event) => { appState.revenueCatDraft.projectId = event.target?.value ?? ""; });
  }

  document.querySelectorAll("[data-action]").forEach((node) => {
    node.addEventListener("click", async () => {
      event.stopPropagation();
      const action = node.getAttribute("data-action");
      if (action === "sphere-click") {
        if (appState.spiderwebFocusDepartmentId) {
          appState.spiderwebFocusDepartmentId = null;
          render();
          return;
        }

        const current = appState.voice?.mode ?? VOICE_MODES.IDLE;
        if (current === VOICE_MODES.IDLE) {
          await runVoiceInteraction(appState.queryDraft || "Give me a brief status update.");
        } else {
          appState.voiceProvider?.stop?.();
          setAudioReactiveLevel(0);
          voiceController.idle();
        }
      } else if (action === "spiderweb-focus") {
        const departmentId = node.getAttribute("data-department-id") ?? "";
        if (!departmentId) {
          return;
        }
        appState.spiderwebFocusDepartmentId = departmentId;
        render();
      } else if (action?.startsWith("nav-")) {
        appState.activeView = action.slice(4); render();
      } else if (action === "openai-configure") {
        appState.openAiModalOpen = true; render();
      } else if (action === "openai-modal-cancel") {
        appState.openAiModalOpen = false; render();
      } else if (action === "openai-modal-save") {
        await configureOpenAiConnection();
      } else if (action === "openai-test") {
        await testOpenAiConnection();
      } else if (action === "elevenlabs-configure") {
        appState.elevenLabsModalOpen = true; render();
      } else if (action === "elevenlabs-modal-cancel") {
        appState.elevenLabsDraft = { voiceId: "", modelId: "" }; appState.elevenLabsModalOpen = false; render();
      } else if (action === "elevenlabs-modal-save") {
        await configureElevenLabsConnection();
      } else if (action === "elevenlabs-test") {
        await testElevenLabsConnection();
      } else if (action === "metricool-api-configure") {
        appState.metricoolDraft = { userId: appState.metricoolConnection.userId, blogId: appState.metricoolConnection.blogId }; appState.metricoolApiModalOpen = true; render();
      } else if (action === "metricool-api-modal-cancel") {
        appState.metricoolDraft = { userId: "", blogId: "" }; appState.metricoolApiModalOpen = false; render();
      } else if (action === "metricool-api-modal-save") {
        await configureMetricoolApiConnection();
      } else if (action === "metricool-api-test") {
        await testMetricoolApiConnection();
      } else if (action === "revenuecat-configure") {
        appState.revenueCatDraft = { projectId: appState.revenueCatConnection.projectId, projects: [] }; appState.revenueCatModalOpen = true; render();
      } else if (action === "revenuecat-modal-cancel") {
        appState.revenueCatDraft = { projectId: "", projects: [] }; appState.revenueCatModalOpen = false; render();
      } else if (action === "revenuecat-modal-save") {
        await configureRevenueCatConnection();
      } else if (action === "revenuecat-test") {
        await testRevenueCatConnection();
      } else if (action === "content-review-access-configure") {
        appState.contentReviewAccessModalOpen = true; render();
      } else if (action === "content-review-access-cancel") {
        appState.contentReviewAccessModalOpen = false; render();
      } else if (action === "content-review-access-save") {
        await configureContentReviewAccess();
      } else if (action === "production-access-configure") {
        appState.productionAccessModalOpen = true; render();
      } else if (action === "production-access-cancel") {
        appState.productionAccessModalOpen = false; render();
      } else if (action === "production-access-save") {
        await configureProductionAccess();
      } else if (action === "publishing-access-configure") {
        appState.publishingAccessModalOpen = true; render();
      } else if (action === "publishing-access-cancel") {
        appState.publishingAccessModalOpen = false; render();
      } else if (action === "publishing-access-save") {
        await configurePublishingAccess();
      } else if (action === "content-review-approve" || action === "content-review-reject") {
        const proposalId = node.getAttribute("data-proposal-id");
        if (proposalId) {
          const operation = action === "content-review-approve" ? "approveProposal" : "rejectProposal";
          await submitContentReviewDecision(proposalId, operation);
        }
      } else if (action === "content-proposal-create") {
        await submitContentProposal();
      } else if (action === "institutional-knowledge-load") {
        await loadInstitutionalKnowledge();
      } else if (action === "institutional-knowledge-create") {
        await submitInstitutionalKnowledgeProposal();
      } else if (action === "institutional-knowledge-approve" || action === "institutional-knowledge-reject") {
        const proposalId = node.getAttribute("data-proposal-id");
        if (proposalId) await reviewInstitutionalKnowledgeProposal(proposalId, action === "institutional-knowledge-approve" ? "approved" : "rejected");
      } else if (action === "production-status-load") {
        const proposalId = appState.productionControl.proposalId || (document.querySelector("[data-production-proposal-select]")?.value ?? "");
        if (proposalId) {
          const credential = window.prompt("Enter your local production credential to load production status:", "");
          if (credential) await loadProductionStatus(proposalId, credential);
        }
      } else if (action === "production-status-refresh") {
        const proposalId = node.getAttribute("data-proposal-id") || appState.productionControl.proposalId;
        if (proposalId) {
          const credential = window.prompt("Enter your local production credential to refresh production status:", "");
          if (credential) await loadProductionStatus(proposalId, credential);
        }
      } else if (action === "production-brief-normalize") {
        const proposalId = node.getAttribute("data-proposal-id");
        if (proposalId) {
          await submitProductionBriefNormalization(proposalId);
        }
      } else if (action === "production-approve" || action === "production-reject") {
        const proposalId = node.getAttribute("data-proposal-id");
        const productionBriefId = node.getAttribute("data-production-brief-id");
        if (proposalId && productionBriefId) {
          const decision = action === "production-approve" ? "approved-for-production" : "rejected-for-production";
          await submitProductionApproval(proposalId, productionBriefId, decision);
        }
      } else if (action === "production-execute") {
        const proposalId = node.getAttribute("data-proposal-id");
        if (proposalId) {
          await submitProductionExecute(proposalId);
        }
      } else if (action === "publishing-queue-enqueue") {
        const proposalId = node.getAttribute("data-proposal-id");
        if (proposalId) {
          await submitEnqueueProposal(proposalId);
        }
      } else if (action === "metricool-preflight") {
        const queueEntryId = node.getAttribute("data-queue-entry-id");
        if (queueEntryId) {
          await submitMetricoolPreflight(queueEntryId);
        }
      } else if (action === "metricool-publish") {
        const queueEntryId = node.getAttribute("data-queue-entry-id");
        if (queueEntryId) {
          await submitMetricoolPublish(queueEntryId);
        }
      }
    });
  });
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && appState.voice?.mode === VOICE_MODES.IDLE) {
    ensureSphereIdleAnimation();
  }
});

async function loadSnapshot() {
  const response = await fetch("/api/command-interface", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load snapshot: ${response.status}`);
  }
  appState.snapshot = await response.json();
  render();
}

// Real GET /api/runtime/health check. Never inferred from page load alone.
async function loadHealth() {
  try {
    const response = await fetch("/api/runtime/health", { cache: "no-store" });
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (response.ok && body?.initialized === true) {
      appState.health = { state: "healthy", body };
    } else if (body) {
      appState.health = { state: "degraded", body };
    } else {
      appState.health = { state: "degraded", body: null };
    }
  } catch {
    appState.health = { state: "unreachable", body: null };
  }
  render();
}

// Real GET /api/trust-review?operation=listTrustReports read. Read-only; no mutation.
async function loadTrustReview() {
  try {
    const response = await fetch("/api/trust-review?operation=listTrustReports", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Trust review request failed: ${response.status}`);
    }
    const payload = await response.json();
    const reports = Array.isArray(payload?.data) ? payload.data : [];
    appState.trustReview = { status: reports.length ? "ok" : "empty", reports };
  } catch {
    appState.trustReview = { status: "error", reports: [] };
  }
  render();
}

// Real GET /api/content-review?operation=listProposals read. Read-only: never creates tasks,
// never executes A-014, never calls the AI provider, and never alters review state.
async function loadContentReview() {
  try {
    const response = await fetch("/api/content-review?operation=listProposals", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Content review request failed: ${response.status}`);
    }
    const payload = await response.json();
    const proposals = Array.isArray(payload?.data) ? payload.data : [];
    appState.contentReview = { status: proposals.length ? "ok" : "empty", proposals };
    if (proposals.length && !appState.productionControl.proposalId) {
      appState.productionControl = { ...appState.productionControl, proposalId: proposals[0].proposalId };
      await loadProductionStatus(proposals[0].proposalId);
      return;
    }
  } catch {
    appState.contentReview = { status: "error", proposals: [] };
  }
  render();
}

async function loadContentReviewAccess() { try { const response = await fetch("/api/content-review-access"); appState.contentReviewAccess = await response.json(); render(); } catch {} }
async function configureContentReviewAccess() { const input = document.querySelector('[data-input="content-review-access-key"]'); const credential = input?.value ?? ""; if (!credential) return; const response = await fetch("/api/content-review-access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential }) }); input.value = ""; if (!response.ok) { window.alert("Content Review access could not be saved."); return; } appState.contentReviewAccessModalOpen = false; await loadContentReviewAccess(); }
async function loadProductionAccess() { try { const response = await fetch("/api/production-access"); appState.productionAccess = await response.json(); render(); } catch {} }
async function configureProductionAccess() { const input = document.querySelector('[data-input="production-access-key"]'); const credential = input?.value ?? ""; if (!credential) return; const response = await fetch("/api/production-access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential }) }); input.value = ""; if (!response.ok) { window.alert("Production Access could not be saved."); return; } appState.productionAccessModalOpen = false; await loadProductionAccess(); }
async function loadPublishingAccess() { try { const response = await fetch("/api/publishing-access"); appState.publishingAccess = await response.json(); render(); } catch {} }
async function configurePublishingAccess() { const input = document.querySelector('[data-input="publishing-access-key"]'); const credential = input?.value ?? ""; if (!credential) return; const response = await fetch("/api/publishing-access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential }) }); input.value = ""; if (!response.ok) { window.alert("Publishing Access could not be saved."); return; } appState.publishingAccessModalOpen = false; await loadPublishingAccess(); }

async function loadOpenAiConnection() { try { const response = await fetch("/api/openai-connection"); appState.openAiConnection = await response.json(); render(); } catch {} }
async function configureOpenAiConnection() { const input = document.querySelector('[data-input="openai-api-key"]'); const apiKey = input?.value ?? ""; if (!apiKey) return; const response = await fetch("/api/openai-connection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey }) }); input.value = ""; if (!response.ok) { window.alert("OpenAI configuration could not be saved."); return; } appState.openAiModalOpen = false; await loadOpenAiConnection(); }
async function testOpenAiConnection() { const response = await fetch("/api/openai-connection/test", { method: "POST" }); appState.openAiConnection = await response.json(); render(); }
async function loadElevenLabsConnection() { try { const response = await fetch("/api/elevenlabs-connection"); appState.elevenLabsConnection = await response.json(); render(); } catch {} }
async function configureElevenLabsConnection() { const key = document.querySelector('[data-input="elevenlabs-api-key"]'); const apiKey = key?.value ?? ""; const { voiceId, modelId } = appState.elevenLabsDraft; const normalizedModelId = modelId.trim(); if (!apiKey || !voiceId) return; const response = await fetch("/api/elevenlabs-connection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey, voiceId, ...(normalizedModelId ? { modelId: normalizedModelId } : {}) }) }); key.value = ""; if (!response.ok) { window.alert("ElevenLabs configuration could not be saved."); return; } appState.elevenLabsDraft = { voiceId: "", modelId: "" }; appState.elevenLabsModalOpen = false; await loadElevenLabsConnection(); }
async function testElevenLabsConnection() { try { const response = await fetch("/api/elevenlabs-connection/test", { method: "POST" }); const payload = await response.json(); appState.elevenLabsConnection = response.ok ? payload : { configured: true, test: "failed", httpStatus: response.status, reason: payload?.error || "The Novara test endpoint rejected the request." }; } catch { appState.elevenLabsConnection = { configured: true, test: "failed", reason: "The Novara server could not be reached." }; } render(); }

async function loadMetricoolApiConnection() { try { const response = await fetch("/api/metricool-connection"); appState.metricoolConnection = await response.json(); render(); } catch {} }
async function configureMetricoolApiConnection() { const key = document.querySelector('[data-input="metricool-api-key"]'); const apiKey = key?.value ?? ""; const userId = appState.metricoolDraft.userId.trim(); const blogId = appState.metricoolDraft.blogId.trim(); if (!apiKey || !userId || !blogId) { window.alert("Metricool API key, User ID, and Blog ID are all required."); return; } try { const response = await fetch("/api/metricool-connection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey, userId, blogId }) }); const payload = await response.json().catch(() => null); key.value = ""; if (!response.ok) { window.alert(`Metricool configuration could not be saved. HTTP ${response.status}: ${payload?.error ?? "unknown error"}`); return; } appState.metricoolDraft = { userId: "", blogId: "" }; appState.metricoolApiModalOpen = false; await loadMetricoolApiConnection(); } catch { window.alert("Metricool configuration could not be saved: the Novara server could not be reached."); } }
async function testMetricoolApiConnection() { try { const response = await fetch("/api/metricool-connection/test", { method: "POST" }); const payload = await response.json(); appState.metricoolConnection = response.ok ? payload : { ...appState.metricoolConnection, test: "failed", httpStatus: response.status, reason: payload?.error || "The Novara test endpoint rejected the request." }; } catch { appState.metricoolConnection = { ...appState.metricoolConnection, test: "failed", reason: "The Novara server could not be reached." }; } render(); }

async function loadRevenueCatConnection() { try { const response = await fetch("/api/revenuecat-connection"); appState.revenueCatConnection = await response.json(); render(); } catch {} }
async function configureRevenueCatConnection() { const key = document.querySelector('[data-input="revenuecat-api-key"]'); const apiKey = key?.value ?? ""; const projectId = appState.revenueCatDraft.projectId.trim(); if (!apiKey && !appState.revenueCatConnection.configured) { window.alert("A RevenueCat V2 secret API key is required."); return; } try { const response = await fetch("/api/revenuecat-connection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey, ...(projectId ? { projectId } : {}) }) }); const payload = await response.json().catch(() => null); if (payload?.selectionRequired && Array.isArray(payload.projects)) { appState.revenueCatDraft = { projectId: "", projects: payload.projects }; render(); return; } if (key) key.value = ""; if (!response.ok) { window.alert(`RevenueCat configuration could not be saved. HTTP ${response.status}: ${payload?.reason ?? payload?.error ?? "unknown error"}`); return; } appState.revenueCatDraft = { projectId: "", projects: [] }; appState.revenueCatModalOpen = false; await loadRevenueCatConnection(); } catch { window.alert("RevenueCat configuration could not be saved: the Novara server could not be reached."); } }
async function testRevenueCatConnection() { try { const response = await fetch("/api/revenuecat-connection/test", { method: "POST" }); const payload = await response.json(); appState.revenueCatConnection = response.ok ? payload : { ...appState.revenueCatConnection, test: "failed", httpStatus: response.status, reason: payload?.error || "The Novara test endpoint rejected the request." }; if (payload?.selectionRequired && Array.isArray(payload.projects)) { appState.revenueCatDraft = { projectId: "", projects: payload.projects }; appState.revenueCatModalOpen = true; } } catch { appState.revenueCatConnection = { ...appState.revenueCatConnection, test: "failed", reason: "The Novara server could not be reached." }; } render(); }

async function submitContentProposal() {
  const { content, platform, goal } = appState.contentDraft;
  try {
    const response = await fetch("/api/content-proposal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, platform, goal }) });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error || "Content proposal failed.");
    appState.contentDraft = { content: "", platform: "TikTok", goal: "" };
    await loadContentReview();
  } catch (error) { window.alert(error.message || "Content proposal failed."); }
}

async function institutionalKnowledgeRequest(body) {
  const credential = window.prompt("Enter your institutional knowledge credential:", "");
  if (!credential) return null;
  const response = await fetch("/api/institutional-knowledge", { method: body ? "POST" : "GET", headers: { "x-novara-institutional-knowledge-key": credential, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.reason || "Institutional knowledge request failed.");
  return payload;
}

async function loadInstitutionalKnowledge() {
  try { const payload = await institutionalKnowledgeRequest(null); if (payload) appState.institutionalKnowledge = { status: "ready", proposals: payload.data ?? [], error: "" }; }
  catch (error) { appState.institutionalKnowledge = { status: "error", proposals: [], error: error.message }; }
  render();
}

async function submitInstitutionalKnowledgeProposal() {
  const targetPath = document.querySelector('[data-input="institutional-target"]')?.value ?? "";
  const proposedContent = document.querySelector('[data-input="institutional-content"]')?.value ?? "";
  const rationale = document.querySelector('[data-input="institutional-rationale"]')?.value ?? "";
  const evidenceReferences = (document.querySelector('[data-input="institutional-evidence"]')?.value ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  try { await institutionalKnowledgeRequest({ operation: "createProposal", targetPath, proposedContent, rationale, evidenceReferences }); await loadInstitutionalKnowledge(); }
  catch (error) { appState.institutionalKnowledge.error = error.message; render(); }
}

async function reviewInstitutionalKnowledgeProposal(proposalId, decision) {
  if (!window.confirm(`${decision === "approved" ? "Approve" : "Reject"} this proposal? Approval does not apply it to the vault.`)) return;
  const reason = decision === "rejected" ? (window.prompt("Optional rejection reason:", "") || undefined) : undefined;
  try { await institutionalKnowledgeRequest({ operation: "reviewProposal", proposalId, decision, reason }); await loadInstitutionalKnowledge(); }
  catch (error) { appState.institutionalKnowledge.error = error.message; render(); }
}

async function loadProductionStatus(proposalId, credential) {
  if (!proposalId) {
    appState.productionControl = { status: "idle", proposalId: "", data: null, error: "No proposal selected." };
    render();
    return;
  }

  appState.productionControlBusy = false;
  appState.productionControl = { status: "loading", proposalId, data: appState.productionControl.data, error: "" };
  render();

  try {
    const response = await fetch(`/api/production-status?proposalId=${encodeURIComponent(proposalId)}`, {
      cache: "no-store",
      ...(credential ? { headers: { "x-novara-production-key": credential } } : {}),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.status !== "ok") {
      throw new Error(payload?.reason || `Production status request failed: ${response.status}`);
    }
    appState.productionControl = { status: "ready", proposalId, data: payload.data, error: "" };
  } catch (error) {
    appState.productionControl = { status: "error", proposalId, data: null, error: error?.message || "Unable to load production status." };
  }
  render();
}

async function submitProductionApproval(proposalId, productionBriefId, decision) {
  if (appState.productionControlBusy) {
    return;
  }

  const credential = window.prompt("Enter your local production credential to continue:", "");
  if (!credential) {
    return;
  }

  appState.productionControlBusy = true;
  render();

  try {
    const response = await fetch("/api/production-approval", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-novara-production-key": credential,
      },
      body: JSON.stringify({ operation: "decideProductionApproval", proposalId, productionBriefId, decision }),
    });
    const payload = await response.json().catch(() => null);
    const result = payload?.result;
    if (!response.ok || !result) {
      const reasonText = payload?.reason || `Request failed with status ${response.status}.`;
      window.alert(`Production approval was not recorded: ${reasonText}`);
      return;
    }
    if (result.status === "created" || result.status === "existing") {
      window.alert(`Production approval recorded: ${result.record?.decision ?? decision}`);
    } else if (result.status === "conflict") {
      window.alert(`Production approval conflict: ${result.reason ?? "A conflicting decision already exists."}`);
    } else {
      window.alert(`Production approval was rejected: ${result.reason ?? "The approval boundary rejected the request."}`);
    }
  } catch {
    window.alert("Production approval request failed: the request could not be completed.");
  } finally {
    appState.productionControlBusy = false;
    await loadProductionStatus(proposalId, credential);
  }
}

async function submitProductionBriefNormalization(proposalId) {
  if (appState.productionControlBusy) {
    return;
  }

  const credential = window.prompt("Enter your local production credential to create or refresh the Production Brief:", "");
  if (!credential) {
    return;
  }

  appState.productionControlBusy = true;
  appState.productionBriefResult = "";
  render();

  try {
    const response = await fetch("/api/production-brief", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-novara-production-key": credential,
      },
      body: JSON.stringify({ operation: "normalizeProductionBrief", proposalId }),
    });
    const payload = await response.json().catch(() => null);
    const result = payload?.result;
    if (!response.ok || !result) {
      appState.productionBriefResult = payload?.reason || `Production Brief request failed with status ${response.status}.`;
      return;
    }
    if (result.status === "rejected") {
      appState.productionBriefResult = `Production Brief was not persisted: ${result.reason ?? "The command rejected the request."}`;
      return;
    }
    appState.productionBriefResult = `Production Brief ${result.status}: ${result.brief?.productionBriefId ?? "unknown"} (${result.brief?.productionReadiness ?? "unknown"})`;
  } catch {
    appState.productionBriefResult = "Production Brief request failed: the request could not be completed.";
  } finally {
    appState.productionControlBusy = false;
    await loadProductionStatus(proposalId, credential);
  }
}

async function submitProductionExecute(proposalId) {
  if (appState.productionControlBusy) {
    return;
  }

  const credential = window.prompt("Enter your local production credential to continue:", "");
  if (!credential) {
    return;
  }

  appState.productionControlBusy = true;
  render();

  try {
    const response = await fetch("/api/production-execute", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-novara-production-key": credential,
      },
      body: JSON.stringify({ operation: "produceApprovedContent", proposalId }),
    });
    const payload = await response.json().catch(() => null);
    const result = payload?.result;
    if (!response.ok || !result) {
      const reasonText = payload?.reason || `Request failed with status ${response.status}.`;
      window.alert(`Production execution was not accepted: ${reasonText}`);
      return;
    }
    if (result.status === "completed") {
      window.alert(`Production completed: ${result.videoAssetId ?? "video ready"}`);
    } else if (result.status === "blocked") {
      window.alert(`Production is blocked: ${result.reason}`);
    } else {
      window.alert(`Production was rejected: ${result.reason}`);
    }
  } catch {
    window.alert("Production execution request failed: the request could not be completed.");
  } finally {
    appState.productionControlBusy = false;
    await loadProductionStatus(proposalId, credential);
  }
}

// The only path that may change content review state. Requires explicit user confirmation
// and a local reviewer credential; never optimistic, always reflects the real server result.
async function submitContentReviewDecision(proposalId, operation) {
  if (appState.contentReviewBusyProposalId) {
    return;
  }

  const verb = operation === "approveProposal" ? "approve" : "reject";
  const confirmed = window.confirm(`Are you sure you want to ${verb} content proposal ${proposalId}? This cannot be undone.`);
  if (!confirmed) {
    return;
  }

  const credential = window.prompt("Enter your local content review credential to continue:", "");
  if (!credential) {
    return;
  }

  let reason;
  if (operation === "rejectProposal") {
    reason = window.prompt("Optional: reason for rejection (leave blank to skip):", "") || undefined;
  }

  appState.contentReviewBusyProposalId = proposalId;
  render();

  try {
    const response = await fetch("/api/content-review-decision", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-novara-content-review-key": credential,
      },
      body: JSON.stringify({ operation, proposalId, reason }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.result?.status !== "created") {
      const reasonText = payload?.result?.reason || payload?.reason || `Request failed with status ${response.status}.`;
      window.alert(`Content review decision was not applied: ${reasonText}`);
    }
  } catch {
    window.alert("Content review decision failed: the request could not be completed.");
  } finally {
    appState.contentReviewBusyProposalId = null;
    await loadContentReview();
  }
}

// Real GET /api/publishing-queue?operation=listEntries read. Read-only: never enqueues,
// executes A-014, or alters queue state.
async function loadPublishingQueue() {
  try {
    const response = await fetch("/api/publishing-queue?operation=listEntries", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Publishing queue request failed: ${response.status}`);
    }
    const payload = await response.json();
    const entries = Array.isArray(payload?.data) ? payload.data : [];
    appState.publishingQueue = { status: entries.length ? "ok" : "empty", entries };
  } catch {
    appState.publishingQueue = { status: "error", entries: [] };
  }
  render();
}

// The only path that may create a publishing queue entry. Requires explicit user confirmation
// and a local credential; never optimistic, always reflects the real server result.
async function submitEnqueueProposal(proposalId) {
  if (appState.publishingQueueBusyProposalId) {
    return;
  }

  const confirmed = window.confirm(`Queue approved content proposal ${proposalId} for future publishing? This does not publish anything yet.`);
  if (!confirmed) {
    return;
  }

  const credential = window.prompt("Enter your local publishing queue credential to continue:", "");
  if (!credential) {
    return;
  }

  appState.publishingQueueBusyProposalId = proposalId;
  render();

  try {
    const response = await fetch("/api/publishing-queue-enqueue", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-novara-publishing-queue-key": credential,
      },
      body: JSON.stringify({ operation: "enqueueProposal", proposalId }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.result?.status !== "created") {
      const reasonText = payload?.result?.reason || payload?.reason || `Request failed with status ${response.status}.`;
      window.alert(`Publishing queue entry was not created: ${reasonText}`);
    }
  } catch {
    window.alert("Publishing queue request failed: the request could not be completed.");
  } finally {
    appState.publishingQueueBusyProposalId = null;
    await loadPublishingQueue();
  }
}

// Real GET /api/metricool-status read. Read-only: never mutates Runtime state, never creates a
// queue entry, and never publishes anything itself.
async function loadMetricoolStatus() {
  try {
    const response = await fetch("/api/metricool-status", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Metricool status request failed: ${response.status}`);
    }
    const payload = await response.json();
    appState.metricoolStatus = { state: payload?.state ?? "not-configured", reason: payload?.reason ?? "" };
  } catch {
    appState.metricoolStatus = { state: "error", reason: "" };
  }
  render();
}

// Explicit validation/preflight only - this never publishes. Requires explicit user
// confirmation and a local credential; always reflects the real server response.
async function submitMetricoolPreflight(queueEntryId) {
  if (appState.metricoolPreflightBusyEntryId) {
    return;
  }

  const confirmed = window.confirm(`Run a Metricool readiness check for queue entry ${queueEntryId}? This only validates readiness and does not publish anything.`);
  if (!confirmed) {
    return;
  }

  const credential = window.prompt("Enter your local Metricool credential to continue:", "");
  if (!credential) {
    return;
  }

  appState.metricoolPreflightBusyEntryId = queueEntryId;
  render();

  try {
    const response = await fetch("/api/metricool-preflight", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-novara-metricool-key": credential,
      },
      body: JSON.stringify({ operation: "preflightQueueEntry", queueEntryId }),
    });
    const payload = await response.json().catch(() => null);
    const result = payload?.result;
    if (!response.ok || !result) {
      window.alert(`Metricool preflight request failed: ${payload?.reason || `status ${response.status}`}.`);
    } else if (result.status === "ready") {
      window.alert("Metricool preflight: ready. This is a validation result only; nothing was published.");
    } else if (result.status === "not-configured") {
      window.alert("Metricool preflight: Metricool is not configured.");
    } else if (result.status === "unavailable") {
      window.alert(`Metricool preflight: unavailable (${result.reason}).`);
    } else {
      window.alert(`Metricool preflight failed validation: ${result.reason}`);
    }
  } catch {
    window.alert("Metricool preflight request failed: the request could not be completed.");
  } finally {
    appState.metricoolPreflightBusyEntryId = null;
    await loadMetricoolStatus();
  }
}

async function submitMetricoolPublish(queueEntryId) {
  if (appState.metricoolPublishBusyEntryId) {
    return;
  }

  const confirmed = window.confirm(`Schedule queue entry ${queueEntryId} through Metricool? This sends a REAL external request to Metricool for Instagram scheduling.`);
  if (!confirmed) {
    return;
  }

  const credential = window.prompt("Enter your dedicated Metricool publishing credential to continue:", "");
  if (!credential) {
    return;
  }

  appState.metricoolPublishBusyEntryId = queueEntryId;
  render();

  try {
    const response = await fetch("/api/publishing-execute", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-novara-metricool-publishing-key": credential,
      },
      body: JSON.stringify({ operation: "publishQueueEntry", queueEntryId }),
    });
    const payload = await response.json().catch(() => null);
    const result = payload?.result;
    if (!response.ok || !result) {
      window.alert(`Metricool scheduling failed: ${payload?.reason || `status ${response.status}`}.`);
    } else if (result.status === "published") {
      window.alert("Metricool scheduling request succeeded. The queue will refresh from persisted server state.");
    } else if (result.status === "unknown-result") {
      window.alert(`Unknown Metricool result: ${result.reason} No automatic retry will occur.`);
    } else {
      window.alert(`Metricool scheduling was blocked: ${result.reason}`);
    }
  } catch {
    window.alert("Metricool scheduling failed: the request outcome is unknown and will not be retried automatically.");
  } finally {
    appState.metricoolPublishBusyEntryId = null;
    await loadPublishingQueue();
  }
}

loadSnapshot().catch((error) => {
  document.body.innerHTML = `<pre style="color:#fff;background:#111;padding:16px;white-space:pre-wrap;">${escapeHtml(error.stack || error.message)}</pre>`;
});

loadHealth();
setInterval(loadHealth, HEALTH_POLL_INTERVAL_MS);

loadTrustReview();
setInterval(loadTrustReview, TRUST_REVIEW_POLL_INTERVAL_MS);

loadContentReview();
setInterval(loadContentReview, CONTENT_REVIEW_POLL_INTERVAL_MS);
loadContentReviewAccess();
loadProductionAccess();
loadPublishingAccess();
loadOpenAiConnection();
loadElevenLabsConnection();
loadMetricoolApiConnection();
loadRevenueCatConnection();

loadPublishingQueue();
setInterval(loadPublishingQueue, PUBLISHING_QUEUE_POLL_INTERVAL_MS);

loadMetricoolStatus();
setInterval(loadMetricoolStatus, METRICOOL_STATUS_POLL_INTERVAL_MS);
