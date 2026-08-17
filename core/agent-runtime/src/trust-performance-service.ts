import type {
  AgentProfile,
  AgentTrustPerformanceReport,
  AuditEvent,
  IntelligenceEvaluationReport,
  TaskRecord,
} from "./types.ts";

export interface TrustEvidence {
  profile: AgentProfile;
  tasks: TaskRecord[];
  evaluationReports: IntelligenceEvaluationReport[];
  auditEvents: AuditEvent[];
  auditAvailable: boolean;
}

function average(values: number[]): number | null {
  return values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100 : null;
}

export class TrustPerformanceService {
  generate(reportId: string, evidence: TrustEvidence): AgentTrustPerformanceReport {
    const generatedAt = new Date().toISOString();
    const operationalTasks = evidence.tasks.filter((task) => !task.handoff?.sourceRequestId?.startsWith("evaluation:"));
    const completed = operationalTasks.filter((task) => task.status === "completed").length;
    const failedOrRejected = operationalTasks.filter((task) => task.status === "failed" || task.status === "escalated").length;
    const outcomeCount = completed + failedOrRejected;
    const completionRate = outcomeCount ? Math.round((completed / outcomeCount) * 10000) / 100 : null;
    const operationalSufficiency = outcomeCount >= 3 ? "sufficient" : "insufficient" as const;

    const evaluationReports = evidence.evaluationReports;
    const evaluationCaseCount = evaluationReports.reduce((sum, report) => sum + report.summary.totalCases, 0);
    const evaluationAverageScore = average(evaluationReports.map((report) => report.summary.averageScore));
    const directionAccuracy = average(evaluationReports.map((report) => report.summary.directionAccuracyPercentage));
    const recommendationAccuracy = average(evaluationReports.map((report) => report.summary.recommendationAccuracyPercentage));
    const confidenceQuality = average(evaluationReports.map((report) => report.summary.confidenceQualityScore));
    const evaluationSufficiency = evaluationCaseCount >= 7 ? "sufficient" : "insufficient" as const;

    const agentAudits = evidence.auditEvents.filter((event) => event.actorId === evidence.profile.id);
    const permissionDenials = agentAudits.filter((event) => event.type === "permission.evaluated" && (event.payload?.result === "denied" || event.payload?.result === "escalation-required"));
    const capabilityMismatches = permissionDenials.filter((event) => String(event.payload?.reason ?? "").toLowerCase().includes("capability"));
    const executionRejections = agentAudits.filter((event) => event.type === "task.execution_rejected");
    const humanApprovalRejectionsIgnored = evidence.auditEvents.filter((event) => event.type === "approval.rejected" && event.actorId !== evidence.profile.id).length;
    const governanceViolations = permissionDenials.length + executionRejections.length;
    const governanceSufficiency = !evidence.auditAvailable ? "unavailable" as const : agentAudits.length >= 3 ? "sufficient" as const : "insufficient" as const;

    const controlledQuality = evaluationAverageScore === null || directionAccuracy === null || recommendationAccuracy === null
      ? 0
      : Math.round((evaluationAverageScore * 0.5 + directionAccuracy * 0.25 + recommendationAccuracy * 0.25) * 0.4 * 100) / 100;
    const confidenceCalibration = confidenceQuality === null ? 0 : Math.round(confidenceQuality * 0.15 * 100) / 100;
    const operationalReliability = outcomeCount < 3
      ? Math.round(((completionRate ?? 0) / 100) * 10 * 100) / 100
      : Math.round(((completionRate ?? 0) / 100) * 30 * 100) / 100;
    const governanceSafety = governanceSufficiency === "unavailable"
      ? 7
      : governanceViolations > 0
        ? Math.max(0, 15 - governanceViolations * 5)
        : governanceSufficiency === "sufficient" ? 15 : 10;
    const trustScore = Math.round((controlledQuality + confidenceCalibration + operationalReliability + governanceSafety) * 100) / 100;

    const reasons: string[] = [];
    if (evaluationSufficiency === "insufficient") reasons.push("Controlled evaluation evidence is incomplete: fewer than seven cases are available.");
    if (operationalSufficiency === "insufficient") reasons.push("Operational reliability evidence is insufficient: fewer than three completed/failed outcomes are available.");
    if (governanceSufficiency === "unavailable") reasons.push("Governance audit evidence is unavailable; safety is assessed provisionally, not as a clean record.");
    if (governanceViolations > 0) reasons.push(`${governanceViolations} attributable governance rejection(s) reduced the safety component.`);
    if (evaluationAverageScore !== null && completionRate !== null && evaluationAverageScore >= 80 && completionRate < 70) reasons.push("Controlled evaluation quality is stronger than observed operational reliability.");

    let trustLevel: AgentTrustPerformanceReport["trustLevel"] = "unproven";
    let recommendation: AgentTrustPerformanceReport["recommendation"] = "gather-more-evidence";
    const evaluationStrong = evaluationSufficiency === "sufficient" && (evaluationAverageScore ?? 0) >= 80 && (confidenceQuality ?? 0) >= 75;
    const operationalStrong = outcomeCount >= 5 && (completionRate ?? 0) >= 80;
    const governanceStrong = governanceSafety >= 10 && governanceViolations === 0;
    if (governanceViolations >= 2 || (outcomeCount >= 3 && (completionRate ?? 0) < 60)) {
      trustLevel = "observed";
      recommendation = "investigate-performance";
    } else if (evaluationStrong && operationalStrong && governanceStrong && trustScore >= 75) {
      trustLevel = "demonstrated";
      recommendation = "eligible-for-human-review";
    } else if (evaluationStrong) {
      trustLevel = "developing";
      recommendation = operationalSufficiency === "insufficient" ? "gather-more-evidence" : "continue-observation";
    } else if (evaluationCaseCount > 0 || outcomeCount > 0) {
      trustLevel = "observed";
      recommendation = "continue-observation";
    }
    if (evaluationStrong && outcomeCount >= 20 && evaluationReports.length >= 3 && (completionRate ?? 0) >= 90 && governanceSafety >= 12 && trustScore >= 85) {
      trustLevel = "proven";
      recommendation = "eligible-for-human-review";
    }

    reasons.push(`Component scores: controlled quality ${controlledQuality}/40, confidence calibration ${confidenceCalibration}/15, operational reliability ${operationalReliability}/30, governance safety ${governanceSafety}/15.`);
    return {
      reportId,
      agentId: evidence.profile.id,
      generatedAt,
      evidenceWindow: { taskOutcomeCount: outcomeCount, evaluationReportIds: evaluationReports.map((report) => report.reportId), evaluationCaseCount, auditEventCount: evidence.auditEvents.length },
      operational: { completed, failedOrRejected, outcomeCount, completionRate, sufficiency: operationalSufficiency },
      evaluation: { reportCount: evaluationReports.length, caseCount: evaluationCaseCount, averageScore: evaluationAverageScore, directionAccuracy, recommendationAccuracy, confidenceQuality, sufficiency: evaluationSufficiency },
      governance: { sufficiency: governanceSufficiency, attributablePermissionDenials: permissionDenials.length, attributableCapabilityMismatches: capabilityMismatches.length, attributableExecutionRejections: executionRejections.length, humanApprovalRejectionsIgnored },
      componentScores: { controlledQuality, confidenceCalibration, operationalReliability, governanceSafety },
      trustScore,
      trustLevel,
      recommendation,
      reasons,
    };
  }
}