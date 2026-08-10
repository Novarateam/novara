import { describeVoiceMode } from "./voice-state.js";

function metricChip(label, value, trend = null) {
  const trendHtml = trend
    ? `<span style='font-size:11px;color:${trend >= 0 ? "oklch(0.75 0.19 150)" : "oklch(0.62 0.2 25)"};'>${trend >= 0 ? "↑" : "↓"} ${Math.abs(trend).toFixed(1)}%</span>`
    : "";

  return `<div style='flex:1;min-width:0;padding:8px 10px;background:oklch(1 0 0 / 0.04);border:1px solid oklch(1 0 0 / 0.07);border-radius:8px;display:flex;flex-direction:column;gap:4px;'>
    <div style='font-size:9.5px;letter-spacing:0.08em;color:oklch(0.65 0.03 250);text-transform:uppercase;'>${label}</div>
    <div style='display:flex;align-items:baseline;justify-content:space-between;gap:8px;'>
      <div style='font-size:14px;color:oklch(0.92 0.02 250);line-height:1.1;'>${value}</div>
      ${trendHtml}
    </div>
  </div>`;
}

function sectionCard(title, body, accent = false) {
  return `<div style='background:oklch(0.2 0.02 255 / 0.55);backdrop-filter:blur(14px);border:1px solid oklch(1 0 0 / 0.08);border-radius:10px;padding:12px 14px;'>
    <div style='font-size:9.5px;letter-spacing:0.14em;color:oklch(0.7 0.05 250);margin-bottom:8px;text-transform:uppercase;'>${title}</div>
    <div style='${accent ? "color:oklch(0.95 0.03 250);" : "color:oklch(0.88 0.02 250);"}font-size:12.5px;line-height:1.5;'>${body}</div>
  </div>`;
}

export function renderCommandRail({ snapshot, departments, voiceState }) {
  const state = snapshot.companyBrief.state;
  const metrics = snapshot.commandInterface?.companyPulse ?? {};
  const monthlyGoal = snapshot.commandInterface?.monthlyGoal ?? {
    label: "TURNOVER",
    current: "€18,420",
    target: "€25,000",
    remaining: "€6,580",
    progress: 73.7,
    pace: "On pace",
  };
  const autonomy = snapshot.commandInterface?.autonomy ?? {
    status: "Operational",
    level: "2",
    percent: 42,
  };

  const attentionItems = [];
  for (const decision of state.pendingDecisions.slice(0, 2)) {
    attentionItems.push({ kind: "Approval", text: decision, detail: "Human decision required" });
  }
  for (const risk of state.risks.slice(0, 1)) {
    attentionItems.push({ kind: "Warning", text: risk, detail: "Investigate before escalation" });
  }
  if (!attentionItems.length) {
    attentionItems.push({ kind: "All systems operational", text: "No decisions required", detail: "Hermes is running normally" });
  }

  const currently = snapshot.commandInterface?.currentNext?.currently ?? state.activeWork[0] ?? "Monitoring company state";
  const next = snapshot.commandInterface?.currentNext?.next ?? state.pendingDecisions[0] ?? "No decisions required";

  const activeAgents = departments.map((dept) => dept.name);
  const visibleAgents = activeAgents.slice(0, 6);

  const voiceLabel = describeVoiceMode(voiceState?.mode);
  const voiceLevel = typeof voiceState?.audioLevel === "number" ? Math.round(voiceState.audioLevel * 100) : 0;

  return `<div style='display:flex;flex-direction:column;gap:10px;width:260px;'>
    ${sectionCard(
      "Company Pulse",
      `<div style='display:flex;flex-direction:column;gap:8px;'>
        <div style='display:flex;gap:8px;'>
          ${metricChip("Revenue", metrics.revenue ?? "No data")}
          ${metricChip("Subscribers", metrics.subscribers ?? "0", metrics.subscribersTrend ?? null)}
        </div>
        <div style='display:flex;gap:8px;'>
          ${metricChip("Clicks", metrics.clicks ?? "0", metrics.clicksTrend ?? null)}
          ${metricChip("Views", metrics.views ?? "0", metrics.viewsTrend ?? null)}
        </div>
        <div style='display:flex;gap:8px;'>
          ${metricChip("Channels Active", String(metrics.channelsActive ?? visibleAgents.length))}
          ${metricChip("Agents Active", String(snapshot.agents?.length ?? metrics.agentsActive ?? departments.length))}
        </div>
      </div>`,
    )}

    ${sectionCard(
      "Needs Your Attention",
      attentionItems
        .map((item) => `<div style='padding:7px 0;border-bottom:1px solid oklch(1 0 0 / 0.05);'>
          <div style='font-size:10px;letter-spacing:0.1em;color:oklch(0.75 0.08 195);text-transform:uppercase;margin-bottom:2px;'>${item.kind}</div>
          <div style='font-size:12.5px;color:oklch(0.93 0.02 250);'>${item.text}</div>
          <div style='font-size:11px;color:oklch(0.65 0.03 250);'>${item.detail}</div>
        </div>`)
        .join("") || `<div>All systems operational · No decisions required</div>`,
      true,
    )}

    ${sectionCard(
      "Currently / Next",
      `<div style='display:flex;flex-direction:column;gap:10px;'>
        <div>
          <div style='font-size:10px;letter-spacing:0.12em;color:oklch(0.65 0.03 250);margin-bottom:2px;text-transform:uppercase;'>Currently</div>
          <div style='font-size:12.5px;color:oklch(0.95 0.03 250);'>${currently}</div>
        </div>
        <div>
          <div style='font-size:10px;letter-spacing:0.12em;color:oklch(0.65 0.03 250);margin-bottom:2px;text-transform:uppercase;'>Next</div>
          <div style='font-size:12.5px;color:oklch(0.95 0.03 250);'>${next}</div>
        </div>
      </div>`,
    )}

    ${sectionCard(
      monthlyGoal.label,
      `<div style='display:flex;flex-direction:column;gap:8px;'>
        <div style='font-size:13px;color:oklch(0.95 0.03 250);'>${monthlyGoal.current} / ${monthlyGoal.target}</div>
        <div style='height:6px;border-radius:999px;background:oklch(1 0 0 / 0.08);overflow:hidden;'>
          <div style='width:${Math.max(0, Math.min(100, monthlyGoal.progress ?? 0))}%;height:100%;background:linear-gradient(90deg, oklch(0.78 0.13 195), oklch(0.6 0.13 220));'></div>
        </div>
        <div style='display:flex;justify-content:space-between;font-size:11px;color:oklch(0.68 0.03 250);'>
          <span>${(monthlyGoal.progress ?? 0).toFixed ? monthlyGoal.progress.toFixed(1) : monthlyGoal.progress}%</span>
          <span>${monthlyGoal.remaining} remaining</span>
        </div>
        <div style='font-size:11px;color:oklch(0.8 0.08 195);'>${monthlyGoal.pace}</div>
      </div>`,
      true,
    )}

    ${sectionCard(
      "Agents",
      `<div style='display:flex;flex-direction:column;gap:8px;'>
        <div style='font-size:13px;color:oklch(0.95 0.03 250);'>${departments.length} agents active</div>
        <div style='display:flex;flex-wrap:wrap;gap:6px;'>
          ${visibleAgents
            .map((name) => `<span style='padding:4px 8px;border-radius:999px;border:1px solid oklch(1 0 0 / 0.1);font-size:11px;color:oklch(0.8 0.05 250);'>${name}</span>`)
            .join("")}
        </div>
      </div>`,
    )}

    ${sectionCard(
      "System / Autonomy",
      `<div style='display:flex;align-items:end;justify-content:space-between;gap:10px;'>
        <div>
          <div style='font-size:10px;letter-spacing:0.12em;color:oklch(0.65 0.03 250);text-transform:uppercase;'>System</div>
          <div style='font-size:12.5px;color:oklch(0.95 0.03 250);'>${autonomy.status}</div>
        </div>
        <div style='text-align:right;'>
          <div style='font-size:10px;letter-spacing:0.12em;color:oklch(0.65 0.03 250);text-transform:uppercase;'>Autonomy</div>
          <div style='font-size:12.5px;color:oklch(0.95 0.03 250);'>Level ${autonomy.level}</div>
          <div style='font-size:11px;color:oklch(0.8 0.08 195);'>${autonomy.percent}% · Hermes ${voiceLabel}</div>
        </div>
      </div>
      <div style='margin-top:8px;height:4px;border-radius:999px;background:oklch(1 0 0 / 0.08);overflow:hidden;'>
        <div style='width:${Math.max(0, Math.min(100, autonomy.percent))}%;height:100%;background:oklch(0.8 0.14 195);'></div>
      </div>
      <div style='margin-top:6px;font-size:11px;color:oklch(0.65 0.03 250);'>Voice state: ${voiceLabel}${voiceState?.mode === "speaking" && voiceLevel ? ` · ${voiceLevel}%` : ""}</div>`,
    )}
  </div>`;
}
