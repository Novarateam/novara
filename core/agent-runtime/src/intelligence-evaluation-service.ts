import type {
  IntelligenceEvaluationCase,
  IntelligenceEvaluationCaseResult,
  IntelligenceEvaluationReport,
  IntelligenceEvaluationRequest,
} from "./types.ts";

type EvaluationExecution = {
  status: "completed" | "failed" | "rejected";
  taskId?: string;
  output?: Record<string, unknown>;
  reason: string;
};

export function createTrendMonitorEvaluationCorpus(): IntelligenceEvaluationCase[] {
  const create = (id: string, values: number[], expectation: IntelligenceEvaluationCase["expectation"], category: string): IntelligenceEvaluationCase => ({
    id,
    agentId: "A-012",
    capability: "trend_monitoring",
    operation: "analyse_trend",
    input: { values },
    expectation,
    metadata: { category },
  });

  return [
    create("trend-upward", [10, 12, 15, 18], { direction: "rising", momentumInterpretation: "positive", recommendation: "monitor-and-evaluate", confidenceRange: { min: 0.75, max: 0.85 }, qualityCriteria: ["clear direction", "positive momentum"] }, "clear-upward"),
    create("trend-downward", [20, 17, 14, 10], { direction: "falling", momentumInterpretation: "negative", recommendation: "investigate-decline", confidenceRange: { min: 0.75, max: 0.85 }, qualityCriteria: ["clear direction", "negative momentum"] }, "clear-downward"),
    create("trend-flat", [10, 10, 10, 10], { direction: "stable", momentumInterpretation: "neutral", recommendation: "continue-observation", confidenceRange: { min: 0.75, max: 0.85 }, qualityCriteria: ["stable direction", "neutral momentum"] }, "flat"),
    create("trend-noisy", [10, 13, 9, 12], { direction: "rising", momentumInterpretation: "positive", recommendation: "monitor-and-evaluate", confidenceRange: { min: 0.55, max: 0.7 }, qualityCriteria: ["noisy confidence is moderated"] }, "noisy"),
    create("trend-spike", [10, 10, 10, 30], { direction: "rising", momentumInterpretation: "positive", recommendation: "monitor-and-evaluate", confidenceRange: { min: 0.75, max: 0.85 }, qualityCriteria: ["spike direction", "positive momentum"] }, "sudden-spike"),
    create("trend-reversal", [10, 20, 15, 12], { direction: "rising", momentumInterpretation: "negative", recommendation: "monitor-and-evaluate", confidenceRange: { min: 0.55, max: 0.7 }, qualityCriteria: ["reversal momentum", "moderated confidence"] }, "reversal"),
    create("trend-ambiguous", [10, 20, 5, 20], { direction: "rising", momentumInterpretation: "positive", recommendation: "monitor-and-evaluate", confidenceRange: { min: 0.55, max: 0.7 }, qualityCriteria: ["conflicting signal confidence"] }, "ambiguous"),
  ];
}

export function scoreTrendEvaluationCase(evaluationCase: IntelligenceEvaluationCase, actualOutput: Record<string, unknown> | undefined, status: EvaluationExecution["status"], taskId: string | undefined, reason: string): IntelligenceEvaluationCaseResult {
  if (status !== "completed" || !actualOutput) {
    return { caseId: evaluationCase.id, status, taskId, directionScore: 0, momentumScore: 0, recommendationScore: 0, confidenceScore: 0, overallScore: 0, passed: false, reason };
  }
  const expected = evaluationCase.expectation;
  const directionScore = expected.direction === undefined || actualOutput.direction === expected.direction ? 35 : 0;
  const momentumScore = expected.momentumInterpretation === undefined || actualOutput.momentumInterpretation === expected.momentumInterpretation ? 20 : 0;
  const recommendationScore = expected.recommendation === undefined || actualOutput.recommendation === expected.recommendation ? 20 : 0;
  const confidence = typeof actualOutput.confidence === "number" ? actualOutput.confidence : Number.NaN;
  const confidenceScore = !expected.confidenceRange || (Number.isFinite(confidence) && confidence >= expected.confidenceRange.min && confidence <= expected.confidenceRange.max) ? 25 : 0;
  const overallScore = directionScore + momentumScore + recommendationScore + confidenceScore;
  return { caseId: evaluationCase.id, status, taskId, actualOutput, directionScore, momentumScore, recommendationScore, confidenceScore, overallScore, passed: overallScore >= 80, reason };
}

export class IntelligenceEvaluationService {
  private readonly executeCase: (reportId: string, evaluationCase: IntelligenceEvaluationCase) => EvaluationExecution;

  constructor(executeCase: (reportId: string, evaluationCase: IntelligenceEvaluationCase) => EvaluationExecution) {
    this.executeCase = executeCase;
  }

  run(request: IntelligenceEvaluationRequest): IntelligenceEvaluationReport {
    const createdAt = new Date().toISOString();
    const seenCaseIds = new Set<string>();
    const cases = request.cases.map((evaluationCase) => {
      if (!evaluationCase.id || seenCaseIds.has(evaluationCase.id) || evaluationCase.agentId !== request.agentId || evaluationCase.capability !== request.capability) {
        return scoreTrendEvaluationCase(evaluationCase, undefined, "rejected", undefined, "Evaluation case identity or agent/capability alignment is invalid.");
      }
      seenCaseIds.add(evaluationCase.id);
      const execution = this.executeCase(request.reportId, evaluationCase);
      return scoreTrendEvaluationCase(evaluationCase, execution.output, execution.status, execution.taskId, execution.reason);
    });
    const totalCases = cases.length;
    const passedCases = cases.filter((entry) => entry.passed).length;
    const completedCases = cases.filter((entry) => entry.status === "completed");
    const average = (values: number[]) => values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100 : 0;
    const completedAt = new Date().toISOString();
    return {
      reportId: request.reportId,
      agentId: request.agentId,
      capability: request.capability,
      createdAt,
      completedAt,
      cases,
      summary: {
        totalCases,
        passedCases,
        failedCases: totalCases - passedCases,
        averageScore: average(cases.map((entry) => entry.overallScore)),
        directionAccuracyPercentage: average(cases.map((entry) => entry.directionScore / 35 * 100)),
        recommendationAccuracyPercentage: average(cases.map((entry) => entry.recommendationScore / 20 * 100)),
        confidenceQualityScore: average(cases.map((entry) => entry.confidenceScore / 25 * 100)),
      },
    };
  }
}