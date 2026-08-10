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
  voiceSequenceTimer: null,
  voiceBusy: false,
  queryDraft: "",
};

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

setVoiceProvider(createServerVoiceProvider());

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

  for (const decision of (state.pendingDecisions ?? []).slice(0, 2)) {
    items.push({ color: PROTOTYPE_COLORS.danger, category: "APPROVAL", title: decision, subtitle: "Human decision required" });
  }

  for (const risk of (state.risks ?? []).slice(0, 1)) {
    items.push({ color: PROTOTYPE_COLORS.warning, category: "WARNING", title: risk, subtitle: "Investigate before escalation" });
  }

  return items;
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
    appState.voiceBusy = false;
    voiceController.idle();
  }
}

function renderSphereMarkup(voiceMode) {
  const sphere = generateSphere();
  const style = VOICE_STYLE[voiceMode] ?? VOICE_STYLE.idle;

  return `
    <div data-action="sphere-click" aria-label="Hermes sphere" role="button" tabindex="0" style="position:relative;width:448px;height:448px;flex:0 0 auto;cursor:pointer;background:none;border:none;padding:0;display:block;outline:none;overflow:visible;animation:${style.edgeAnim};">
      <div style="position:absolute;inset:-34px;border-radius:50%;box-shadow:0 0 120px 34px rgba(127,179,255,0.26);opacity:${style.baseGlow};filter:blur(34px);animation:${style.edgeAnim};"></div>
      <svg viewBox="0 0 200 200" width="448" height="448" style="position:relative;filter:brightness(${style.heartBrightness});">
        <g style="transform-origin:100px 100px;animation:${style.breatheAnim};">
          ${sphere.edges
            .map(({ i, j }) => {
              const a = sphere.points[i];
              const b = sphere.points[j];
              return `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${PROTOTYPE_COLORS.accent}" stroke-width="0.45" opacity="0.28"></line>`;
            })
            .join("")}
          ${sphere.points
            .map((point) => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${point.r.toFixed(1)}" fill="${PROTOTYPE_COLORS.accent}" opacity="${point.o}"></circle>`)
            .join("")}
        </g>
      </svg>
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
  const goal = snapshot.commandInterface.monthlyGoal;
  const updatedAt = snapshot.generatedAt ? new Date(snapshot.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "LIVE";
  const voiceMode = appState.voice?.mode ?? VOICE_MODES.IDLE;
  const currently = snapshot.commandInterface.currentNext.currently;
  const next = snapshot.commandInterface.currentNext.next;
  const autonomy = snapshot.commandInterface.autonomy ?? { status: "Operational", level: "2", percent: 42 };
  const hasMonthlyGoal = Boolean(goal?.configured && goal.current != null && goal.target != null && goal.progress != null);

  document.body.innerHTML = `
    <div class="app-shell" style="background:${PROTOTYPE_COLORS.bgPage};color:${PROTOTYPE_COLORS.textPrimary};font-family:'Inter',sans-serif;display:flex;flex-direction:column;overflow:hidden;position:relative;box-sizing:border-box;width:100vw;height:100vh;">
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

      <div style="flex:1 1 auto;display:grid;grid-template-columns:405px 1fr 405px;gap:24px;padding:20px 36px 15px;min-height:0;overflow-y:auto;">
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
          ${renderSphereMarkup(voiceMode)}
          <div style="width:100%;max-width:630px;text-align:center;font-size:20px;color:${PROTOTYPE_COLORS.textPrimary};line-height:1.4;min-height:30px;">${escapeHtml(appState.voice?.transcript ?? "")}</div>
          <input value="${escapeHtml(appState.queryDraft)}" placeholder="Type a message to Hermes" style="width:100%;max-width:540px;background:transparent;border:none;border-bottom:1px solid ${PROTOTYPE_COLORS.borderSubtle};padding:9px 6px;color:${PROTOTYPE_COLORS.textSecondary};font-size:19px;font-family:'Inter',sans-serif;outline:none;text-align:center;" data-input="hermes-draft" ${appState.voiceBusy ? "disabled" : ""} />
        </div>

        <div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:16px;padding:24px 27px;background:${PROTOTYPE_COLORS.bgPanel};display:flex;flex-direction:column;gap:18px;transition:border-color .5s ease;height:fit-content;">
          <div style="font-size:16px;letter-spacing:0.08em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;">${escapeHtml(String(snapshot.commandInterface.agentCount ?? agents.length))} AGENTS ACTIVE</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${activeAgentNames.map((name, index) => `<div style="display:flex;align-items:center;gap:7px;font-size:13px;color:${PROTOTYPE_COLORS.textSecondary};"><div style="width:8px;height:8px;border-radius:50%;background:${index % 2 === 0 ? PROTOTYPE_COLORS.accent : PROTOTYPE_COLORS.textTertiary};"></div>${name}</div>`).join("")}
          </div>
          <div style="font-size:19px;color:${PROTOTYPE_COLORS.textSecondary};line-height:1.45;max-width:300px;">The organization is active. Open a name to inspect it.</div>
          <div style="font-size:19px;color:${PROTOTYPE_COLORS.accent};cursor:pointer;margin-top:4px;">View organization →</div>
        </div>
      </div>

      <div style="padding:0 36px 24px;display:flex;flex-direction:column;gap:12px;">
        <div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:39px;padding:14px 30px;background:${PROTOTYPE_COLORS.bgPanel};display:flex;align-items:center;gap:18px;transition:border-color .5s ease;flex-wrap:wrap;justify-content:center;">
          <div style="font-size:16px;letter-spacing:0.06em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;">${escapeHtml(goal.label ?? "MONTHLY TURNOVER GOAL")}</div>
          ${hasMonthlyGoal ? `<svg width="45" height="45" viewBox="0 0 96 96"><circle cx="48" cy="48" r="40" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="12"></circle><circle cx="48" cy="48" r="40" fill="none" stroke="${PROTOTYPE_COLORS.accent}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${((Math.max(0, Math.min(100, goal.progress)) / 100) * (2 * Math.PI * 40)).toFixed(2)} ${(2 * Math.PI * 40).toFixed(2)}" transform="rotate(-90 48 48)"></circle></svg><div style="font-family:'IBM Plex Mono',monospace;font-size:19px;color:${PROTOTYPE_COLORS.textPrimary};">${escapeHtml(goal.progress.toFixed(1))}%</div><div style="width:1px;height:21px;background:${PROTOTYPE_COLORS.borderSubtle};"></div><div style="display:flex;gap:15px;font-family:'IBM Plex Mono',monospace;font-size:17px;"><div><span style="color:${PROTOTYPE_COLORS.textTertiary};">ACTUAL </span><span>${escapeHtml(goal.current)}</span></div><div><span style="color:${PROTOTYPE_COLORS.textTertiary};">LEFT </span><span style="color:${PROTOTYPE_COLORS.textSecondary};">${escapeHtml(goal.remaining)}</span></div></div><div style="width:1px;height:21px;background:${PROTOTYPE_COLORS.borderSubtle};"></div><div style="font-size:16px;letter-spacing:0.05em;color:${PROTOTYPE_COLORS.accent};">${escapeHtml(String(goal.pace ?? ""))}</div>` : `<div style="font-size:19px;color:${PROTOTYPE_COLORS.textSecondary};font-family:'IBM Plex Mono',monospace;">No data</div>`}
        </div>
      </div>
    </div>
  `;

  bindEvents();
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

  document.querySelectorAll("[data-action]").forEach((node) => {
    node.addEventListener("click", async () => {
      const action = node.getAttribute("data-action");
      if (action === "sphere-click") {
        const current = appState.voice?.mode ?? VOICE_MODES.IDLE;
        if (current === VOICE_MODES.IDLE) {
          await runVoiceInteraction(appState.queryDraft || "Give me a brief status update.");
        } else {
          appState.voiceProvider?.stop?.();
          voiceController.idle();
        }
      }
    });
  });
}

async function loadSnapshot() {
  const response = await fetch("/api/command-interface", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load snapshot: ${response.status}`);
  }
  appState.snapshot = await response.json();
  render();
}

loadSnapshot().catch((error) => {
  document.body.innerHTML = `<pre style="color:#fff;background:#111;padding:16px;white-space:pre-wrap;">${escapeHtml(error.stack || error.message)}</pre>`;
});
