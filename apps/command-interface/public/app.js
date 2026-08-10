import { createVoiceController, createNoopVoiceProvider } from "./modules/voice-provider.js";
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
  sphere: null,
  voiceSequenceTimer: null,
};

const voiceController = createVoiceController({
  onChange: (nextState) => {
    appState.voice = nextState;
    render();
  },
});

voiceController.attachProvider(createNoopVoiceProvider());

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
        revenue: commandInterface.companyPulse?.revenue ?? "No data",
        subscribers: commandInterface.companyPulse?.subscribers ?? "0",
        subscribersTrend: commandInterface.companyPulse?.subscribersTrend ?? null,
        clicks: commandInterface.companyPulse?.clicks ?? "0",
        clicksTrend: commandInterface.companyPulse?.clicksTrend ?? null,
        views: commandInterface.companyPulse?.views ?? "0",
        viewsTrend: commandInterface.companyPulse?.viewsTrend ?? null,
        channelsActive: commandInterface.companyPulse?.channelsActive ?? 2,
        agentsActive: commandInterface.companyPulse?.agentsActive ?? agents.length,
      },
      currentNext: {
        currently: commandInterface.currentNext?.currently ?? state.activeWork?.[0] ?? "Monitoring company state",
        next: commandInterface.currentNext?.next ?? state.pendingDecisions?.[0] ?? "No decisions required",
      },
      monthlyGoal: {
        label: commandInterface.monthlyGoal?.label ?? "TURNOVER",
        current: commandInterface.monthlyGoal?.current ?? "€18,420",
        target: commandInterface.monthlyGoal?.target ?? "€25,000",
        remaining: commandInterface.monthlyGoal?.remaining ?? "€6,580",
        progress: commandInterface.monthlyGoal?.progress ?? 73.7,
        pace: commandInterface.monthlyGoal?.pace ?? "On pace",
      },
      autonomy: {
        status: commandInterface.autonomy?.status ?? "Operational",
        level: commandInterface.autonomy?.level ?? "2",
        percent: commandInterface.autonomy?.percent ?? 42,
      },
      agentCount: commandInterface.agentCount ?? agents.length,
    },
  };
}

function buildMetrics(snapshot) {
  const pulse = snapshot.commandInterface.companyPulse;
  return [
    { label: "REVENUE", value: pulse.revenue, growth: "", arrow: "" },
    {
      label: "SUBSCRIBERS",
      value: pulse.subscribers,
      growth: pulse.subscribersTrend == null ? "Baseline" : `${Math.abs(pulse.subscribersTrend).toFixed(1)}%`,
      arrow: pulse.subscribersTrend == null ? "" : pulse.subscribersTrend >= 0 ? "▲" : "▼",
    },
    {
      label: "CLICKS",
      value: pulse.clicks,
      growth: pulse.clicksTrend == null ? "Baseline" : `${Math.abs(pulse.clicksTrend).toFixed(1)}%`,
      arrow: pulse.clicksTrend == null ? "" : pulse.clicksTrend >= 0 ? "▲" : "▼",
    },
    {
      label: "VIEWS",
      value: pulse.views,
      growth: pulse.viewsTrend == null ? "Baseline" : `${Math.abs(pulse.viewsTrend).toFixed(1)}%`,
      arrow: pulse.viewsTrend == null ? "" : pulse.viewsTrend >= 0 ? "▲" : "▼",
    },
    { label: "CHANNELS ACTIVE", value: String(pulse.channelsActive ?? 0), growth: "Active", arrow: "●" },
    { label: "AGENTS ACTIVE", value: String(pulse.agentsActive ?? 0), growth: "Active", arrow: "▲" },
  ];
}

function buildAttentionItems(snapshot) {
  const state = snapshot.companyBrief?.state ?? {};
  const strategicDecision = snapshot.strategicDecision;
  const items = [];

  for (const decision of (state.pendingDecisions ?? []).slice(0, 2)) {
    items.push({ color: PROTOTYPE_COLORS.danger, category: "APPROVAL", title: decision, subtitle: "Human decision required" });
  }

  for (const risk of (state.risks ?? []).slice(0, 1)) {
    items.push({ color: PROTOTYPE_COLORS.warning, category: "WARNING", title: risk, subtitle: "Investigate before escalation" });
  }

  if (strategicDecision?.status === "proposed") {
    items.push({
      color: PROTOTYPE_COLORS.accent,
      category: "RECOMMENDATION",
      title: strategicDecision.ceoDecision ?? "Opportunity remains proposed",
      subtitle: strategicDecision.interpretation ?? "External evidence is still insufficient",
    });
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
  for (let i = 0; i < 220; i += 1) {
    const ang = rand() * Math.PI * 2;
    const rad = Math.sqrt(rand()) * 92;
    const depth = rand();
    points.push({
      x: 100 + Math.cos(ang) * rad,
      y: 100 + Math.sin(ang) * rad,
      r: 0.9 + depth * 1.5,
      o: 0.4 + depth * 0.55,
    });
  }

  const edges = [];
  const seen = new Set();
  points.forEach((point, i) => {
    const dists = points
      .map((candidate, j) => ({ j, d: j === i ? Infinity : Math.hypot(point.x - candidate.x, point.y - candidate.y) }))
      .sort((a, b) => a.d - b.d);

    for (let k = 0; k < 4; k += 1) {
      const { j, d } = dists[k];
      if (d < 15) {
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

function voiceSequence(mode) {
  clearTimeout(appState.voiceSequenceTimer);

  if (mode === VOICE_MODES.IDLE) {
    voiceController.idle();
    voiceController.setTranscript("");
    return;
  }

  if (mode === VOICE_MODES.LISTENING) {
    voiceController.listening();
    voiceController.setTranscript("");
    appState.voiceSequenceTimer = setTimeout(() => voiceSequence(VOICE_MODES.THINKING), 700);
    return;
  }

  if (mode === VOICE_MODES.THINKING) {
    voiceController.thinking();
    appState.voiceSequenceTimer = setTimeout(() => voiceSequence(VOICE_MODES.SPEAKING), 800);
    return;
  }

  if (mode === VOICE_MODES.SPEAKING) {
    voiceController.speaking(1);
    appState.voiceSequenceTimer = setTimeout(() => voiceSequence(VOICE_MODES.IDLE), 1800);
  }
}

function renderSphereMarkup(voiceMode) {
  const sphere = generateSphere();
  const style = VOICE_STYLE[voiceMode] ?? VOICE_STYLE.idle;
  const sphereShadow = {
    idle: "0 0 110px 18px rgba(127,179,255,0.12)",
    listening: "0 0 128px 22px rgba(127,179,255,0.18)",
    thinking: "0 0 138px 26px rgba(127,179,255,0.22)",
    speaking: "0 0 96px 20px rgba(127,179,255,0.16)",
  }[voiceMode] ?? "0 0 110px 18px rgba(127,179,255,0.12)";

  const atmosphereOpacity = {
    idle: 0.16,
    listening: 0.24,
    thinking: 0.28,
    speaking: 0.2,
  }[voiceMode] ?? 0.16;

  return `
    <button type="button" data-action="sphere-click" aria-label="Hermes sphere" style="position:relative;width:420px;height:420px;flex:0 0 auto;cursor:pointer;background:none;border:none;padding:0;display:block;outline:none;box-shadow:${sphereShadow};animation:${style.edgeAnim};">
      <svg viewBox="0 0 200 200" width="420" height="420" style="position:relative;filter:brightness(${style.heartBrightness});">
        <defs>
          <radialGradient id="sphereCore" cx="50%" cy="48%" r="56%">
            <stop offset="0%" stop-color="rgba(1,2,4,1)" />
            <stop offset="45%" stop-color="rgba(3,4,6,1)" />
            <stop offset="73%" stop-color="rgba(8,10,14,0.98)" />
            <stop offset="100%" stop-color="rgba(127,179,255,0.08)" />
          </radialGradient>
          <radialGradient id="sphereHalo" cx="50%" cy="50%" r="50%">
            <stop offset="72%" stop-color="rgba(0,0,0,0)" />
            <stop offset="92%" stop-color="rgba(127,179,255,0.08)" />
            <stop offset="100%" stop-color="rgba(255,255,255,0.02)" />
          </radialGradient>
        </defs>
        <g style="transform-origin:100px 100px;animation:${style.breatheAnim};">
          <circle cx="100" cy="100" r="94" fill="rgba(2,3,4,0.9)"></circle>
          <circle cx="100" cy="100" r="86" fill="url(#sphereHalo)" opacity="${atmosphereOpacity}"></circle>
          <circle cx="100" cy="100" r="76" fill="url(#sphereCore)" opacity="1"></circle>
          <circle cx="100" cy="100" r="71" fill="rgba(0,0,0,0.98)"></circle>
          <circle cx="100" cy="100" r="77" fill="none" stroke="rgba(255,255,255,0.045)" stroke-width="0.9" opacity="0.85"></circle>
          <circle cx="100" cy="100" r="81" fill="none" stroke="rgba(127,179,255,0.12)" stroke-width="0.9" opacity="${style.energyOpacity}"></circle>
          <g style="opacity:${style.baseGlow};animation:${style.spinAnim};transform-origin:100px 100px;">
            ${sphere.edges
              .map(({ i, j }) => {
                const a = sphere.points[i];
                const b = sphere.points[j];
                return `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="rgba(127,179,255,0.05)" stroke-width="0.4"></line>`;
              })
              .join("")}
            ${sphere.points
              .map((point) => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${point.r.toFixed(1)}" fill="rgba(238,241,245,${point.o * 0.06})"></circle>`)
              .join("")}
          </g>
        </g>
      </svg>
      <div style="position:absolute;inset:-28px;border-radius:50%;box-shadow:0 0 86px 22px rgba(127,179,255,${style.energyOpacity * 0.35});filter:blur(34px);opacity:${style.baseGlow};animation:${style.edgeAnim};"></div>
      <div style="position:absolute;inset:10px;border-radius:50%;background:conic-gradient(from 0deg, transparent 0deg, rgba(127,179,255,${style.energyOpacity}) 10deg, transparent 46deg);opacity:${style.energyOpacity};animation:${style.spinAnim};pointer-events:none;"></div>
    </button>
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
  const activeAgentNames = agents.slice(0, 6).map((agent) => escapeHtml(agent.name ?? agent.id ?? "Agent"));
  const goal = snapshot.commandInterface.monthlyGoal;
  const autonomy = snapshot.commandInterface.autonomy;
  const updatedAt = snapshot.generatedAt ? new Date(snapshot.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "LIVE";
  const voiceMode = appState.voice?.mode ?? VOICE_MODES.IDLE;
  const voiceModeLabel = voiceMode === VOICE_MODES.LISTENING ? "Listening" : voiceMode === VOICE_MODES.THINKING ? "Thinking" : voiceMode === VOICE_MODES.SPEAKING ? "Speaking" : "Idle";
  const companyPulse = snapshot.commandInterface.companyPulse;
  const currently = snapshot.commandInterface.currentNext.currently;
  const next = snapshot.commandInterface.currentNext.next;
  const bottomProgress = Math.max(0, Math.min(100, goal.progress ?? 0));

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
          <div style="font-size:16px;color:${PROTOTYPE_COLORS.textTertiary};white-space:nowrap;">AUTONOMY · LVL ${escapeHtml(String(autonomy.level))}</div>
          <div style="font-size:16px;color:${PROTOTYPE_COLORS.textTertiary};white-space:nowrap;">SYSTEM · ${escapeHtml(autonomy.status)}</div>
        </div>
      </div>

      <div style="flex:1 1 auto;display:grid;grid-template-columns:405px 1fr 405px;gap:24px;padding:20px 36px 15px;min-height:0;overflow-y:auto;">
        <div style="display:flex;flex-direction:column;gap:9px;height:fit-content;">
          <div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:16px;padding:14px 20px;background:${PROTOTYPE_COLORS.bgPanel};display:flex;flex-direction:column;gap:11px;">
            <div style="font-size:16px;letter-spacing:0.08em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;">COMPANY PULSE</div>
            <div style="display:flex;flex-direction:column;gap:9px;">
              ${metrics
                .map(
                  (metric) => `<div style="display:grid;grid-template-columns:160px 100px 1fr;align-items:baseline;"><div style="font-size:14px;letter-spacing:0.04em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;">${escapeHtml(metric.label)}</div><div style="font-size:21px;font-family:'IBM Plex Mono',monospace;color:${PROTOTYPE_COLORS.textPrimary};">${escapeHtml(metric.value)}</div><div style="font-size:14px;font-family:'IBM Plex Mono',monospace;color:${PROTOTYPE_COLORS.textTertiary};">${escapeHtml(metric.arrow)} ${escapeHtml(metric.growth)}</div></div>`,
                )
                .join("")}
            </div>
          </div>

          <div style="border:1px solid ${attentionItems.length ? PROTOTYPE_COLORS.danger : PROTOTYPE_COLORS.borderSubtle};border-radius:16px;padding:14px 20px;background:${PROTOTYPE_COLORS.bgPanel};display:flex;flex-direction:column;gap:12px;">
            <div style="font-size:15px;letter-spacing:0.08em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;">NEEDS YOUR ATTENTION</div>
            ${attentionItems.length ? attentionItems.map((item) => `<div style="display:flex;align-items:flex-start;gap:12px;"><div style="width:10px;height:10px;border-radius:50%;background:${escapeHtml(item.color)};margin-top:6px;flex:0 0 auto;"></div><div><div style="font-size:14px;letter-spacing:0.06em;color:${escapeHtml(item.color)};font-family:'IBM Plex Mono',monospace;">${escapeHtml(item.category)}</div><div style="font-size:19px;color:${PROTOTYPE_COLORS.textPrimary};margin-top:2px;">${escapeHtml(item.title)}</div><div style="font-size:16px;color:${PROTOTYPE_COLORS.textSecondary};margin-top:2px;">${escapeHtml(item.subtitle)}</div></div></div>`).join("") : `<div style="font-size:19px;color:${PROTOTYPE_COLORS.textTertiary};line-height:1.4;">All systems operating normally. No decisions required.</div>`}
          </div>

          <div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:16px;padding:14px 20px;background:${PROTOTYPE_COLORS.bgPanel};display:flex;flex-direction:column;gap:12px;">
            <div>
              <div style="font-size:14px;letter-spacing:0.08em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;">CURRENTLY</div>
              <div style="font-size:19px;color:${PROTOTYPE_COLORS.textPrimary};margin-top:2px;">${escapeHtml(currently)}</div>
            </div>
            <div>
              <div style="font-size:14px;letter-spacing:0.08em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;">NEXT</div>
              <div style="font-size:19px;color:${PROTOTYPE_COLORS.textSecondary};margin-top:2px;">${escapeHtml(next)}</div>
            </div>
          </div>
        </div>

        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;min-width:0;min-height:0;">
          <div style="height:18px;flex:0 0 auto;"></div>
          ${renderSphereMarkup(voiceMode)}
          <div style="width:100%;max-width:630px;min-height:120px;"></div>
        </div>

        <div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:16px;padding:24px 27px;background:${PROTOTYPE_COLORS.bgPanel};display:flex;flex-direction:column;gap:18px;transition:border-color .5s ease;height:fit-content;">
          <div style="font-size:16px;letter-spacing:0.08em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;">ACTIVE AGENTS</div>
          <div style="display:flex;gap:15px;flex-wrap:wrap;">
            ${activeAgentNames.map((name, index) => `<div style="display:flex;align-items:center;gap:7px;font-size:17px;color:${PROTOTYPE_COLORS.textSecondary};"><div style="width:10px;height:10px;border-radius:50%;background:${index % 2 === 0 ? PROTOTYPE_COLORS.accent : PROTOTYPE_COLORS.textTertiary};"></div>${name}</div>`).join("")}
          </div>
        </div>
      </div>

      <div style="padding:0 36px 24px;display:flex;flex-direction:column;gap:12px;">
        <div style="border:1px solid ${PROTOTYPE_COLORS.borderSubtle};border-radius:39px;padding:14px 30px;background:${PROTOTYPE_COLORS.bgPanel};display:flex;align-items:center;gap:18px;transition:border-color .5s ease;flex-wrap:wrap;justify-content:center;">
          <div style="font-size:16px;letter-spacing:0.06em;color:${PROTOTYPE_COLORS.textTertiary};font-family:'IBM Plex Mono',monospace;">MONTHLY TURNOVER GOAL</div>
          <svg width="45" height="45" viewBox="0 0 96 96">
            <circle cx="48" cy="48" r="40" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="12"></circle>
            <circle cx="48" cy="48" r="40" fill="none" stroke="${PROTOTYPE_COLORS.accent}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${((bottomProgress / 100) * (2 * Math.PI * 40)).toFixed(2)} ${ (2 * Math.PI * 40).toFixed(2)}" transform="rotate(-90 48 48)"></circle>
          </svg>
          <div style="font-family:'IBM Plex Mono',monospace;font-size:19px;color:${PROTOTYPE_COLORS.textPrimary};">${escapeHtml(goal.progress.toFixed(1))}%</div>
          <div style="width:1px;height:21px;background:${PROTOTYPE_COLORS.borderSubtle};"></div>
          <div style="display:flex;gap:15px;font-family:'IBM Plex Mono',monospace;font-size:17px;">
            <div><span style="color:${PROTOTYPE_COLORS.textTertiary};">ACTUAL </span><span>${escapeHtml(goal.current)}</span></div>
            <div><span style="color:${PROTOTYPE_COLORS.textTertiary};">LEFT </span><span style="color:${PROTOTYPE_COLORS.textSecondary};">${escapeHtml(goal.remaining)}</span></div>
          </div>
          <div style="width:1px;height:21px;background:${PROTOTYPE_COLORS.borderSubtle};"></div>
          <div style="font-size:16px;letter-spacing:0.05em;color:${PROTOTYPE_COLORS.accent};">${escapeHtml(goal.pace.toUpperCase())}</div>
        </div>
      </div>
    </div>
  `;

  bindEvents();
}

function bindEvents() {
  document.querySelectorAll("[data-action]").forEach((node) => {
    node.addEventListener("click", () => {
      const action = node.getAttribute("data-action");
      if (action === "sphere-click") {
        const current = appState.voice?.mode ?? VOICE_MODES.IDLE;
        if (current === VOICE_MODES.IDLE) {
          voiceSequence(VOICE_MODES.LISTENING);
        } else {
          voiceSequence(VOICE_MODES.IDLE);
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
