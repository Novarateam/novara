import type { BoundedExecutionResult, BoundedOperation } from "./types.ts";

export interface InternalExecutionAdapter {
  operation: BoundedOperation;
  requiredCapability: string;
  compatibleCapabilities?: string[];
  execute(input: unknown): BoundedExecutionResult;
}

function requireRecord(value: unknown, operation: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${operation} requires an object input.`);
  }
  return value as Record<string, unknown>;
}

function numberField(input: Record<string, unknown>, key: string): number {
  const value = input[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`score_opportunity requires ${key} to be a number from 0 to 100.`);
  }
  return value;
}

function policySnapshot(value: unknown, field: string): Map<string, string> {
  const result = new Map<string, string>();
  const add = (id: string, text: string) => result.set(id, text.trim());
  if (typeof value === "string") {
    value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((line) => add(line, line));
    return result;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (typeof item === "string" && item.trim()) add(item.trim(), item);
      else if (item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string" && typeof (item as Record<string, unknown>).text === "string") {
        add((item as Record<string, unknown>).id as string, (item as Record<string, unknown>).text as string);
      } else throw new Error(`${field} contains an unsupported policy item at index ${index}.`);
    });
    return result;
  }
  if (value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).items)) {
    return policySnapshot((value as Record<string, unknown>).items, field);
  }
  throw new Error(`${field} requires text, an array, or an items snapshot.`);
}

const adapters: InternalExecutionAdapter[] = [
  {
    operation: "analyse_text",
    requiredCapability: "analysis",
    execute(input) {
      const text = typeof input === "string" ? input : requireRecord(input, "analyse_text").text;
      if (typeof text !== "string") throw new Error("analyse_text requires a text string.");
      const trimmed = text.trim();
      return { operation: "analyse_text", output: { characters: text.length, words: trimmed ? trimmed.split(/\s+/).length : 0, lines: text === "" ? 0 : text.split(/\r?\n/).length } };
    },
  },
  {
    operation: "score_opportunity",
    requiredCapability: "opportunity_analysis",
    compatibleCapabilities: ["analysis", "publication"],
    execute(input) {
      const value = requireRecord(input, "score_opportunity");
      const score = numberField(value, "audienceValue") * 0.2 + numberField(value, "potential") * 0.2 + numberField(value, "timing") * 0.15 + numberField(value, "evidence") * 0.15 + numberField(value, "novaraFit") * 0.1 + numberField(value, "differentiation") * 0.1 + numberField(value, "feasibility") * 0.05 + numberField(value, "learningValue") * 0.05;
      const roundedScore = Math.round(score * 100) / 100;
      return { operation: "score_opportunity", output: { score: roundedScore, recommendation: roundedScore >= 70 ? "recommend" : "continue-research" } };
    },
  },
  {
    operation: "validate_data",
    requiredCapability: "analysis",
    execute(input) {
      const value = requireRecord(input, "validate_data");
      const requiredFields = Array.isArray(value.requiredFields) ? value.requiredFields.filter((field): field is string => typeof field === "string") : [];
      const data = value.data && typeof value.data === "object" && !Array.isArray(value.data) ? value.data as Record<string, unknown> : {};
      const missingFields = requiredFields.filter((field) => data[field] === undefined || data[field] === null || data[field] === "");
      return { operation: "validate_data", output: { valid: missingFields.length === 0, missingFields } };
    },
  },
  {
    operation: "analyse_trend",
    requiredCapability: "trend_monitoring",
    execute(input) {
      const value = requireRecord(input, "analyse_trend");
      const values = Array.isArray(value.values) ? value.values : [];
      if (values.some((item) => typeof item !== "number" || !Number.isFinite(item))) throw new Error("analyse_trend requires finite numeric values.");
      const numericValues = values as number[];
      if (numericValues.length < 2) return { operation: "analyse_trend", output: { direction: "insufficient-data", percentageChange: null, average: numericValues.length ? numericValues[0] : null, momentum: null, confidence: 0.2, explanation: "At least two values are required to determine a trend." } };
      const baseline = typeof value.baseline === "number" && Number.isFinite(value.baseline) ? value.baseline : numericValues[0];
      const latest = numericValues[numericValues.length - 1];
      const change = latest - baseline;
      const percentageChange = baseline === 0 ? null : Math.round((change / Math.abs(baseline)) * 10000) / 100;
      const direction = Math.abs(change) < 0.000001 ? "stable" : change > 0 ? "rising" : "falling";
      const average = Math.round((numericValues.reduce((sum, item) => sum + item, 0) / numericValues.length) * 100) / 100;
      const momentum = latest - numericValues[numericValues.length - 2];
      const changes = numericValues.slice(1).map((item, index) => item - numericValues[index]);
      const nonZeroSigns = changes.filter((change) => Math.abs(change) >= 0.000001).map((change) => change > 0 ? "positive" : "negative");
      const consistency = nonZeroSigns.length === 0 ? 1 : Math.max(nonZeroSigns.filter((sign) => sign === "positive").length, nonZeroSigns.filter((sign) => sign === "negative").length) / nonZeroSigns.length;
      const baseConfidence = numericValues.length >= 4 ? 0.8 : numericValues.length === 3 ? 0.65 : 0.5;
      const confidence = Math.round((baseConfidence * (0.5 + consistency * 0.5)) * 100) / 100;
      const momentumInterpretation = Math.abs(momentum) < 0.000001 ? "neutral" : momentum > 0 ? "positive" : "negative";
      const notableSignal = direction === "stable" ? "No material directional change detected." : `${direction} signal with ${momentum >= 0 ? "positive" : "negative"} latest momentum.`;
      return { operation: "analyse_trend", output: { direction, percentageChange, average, momentum, momentumInterpretation, confidence, valuesCount: numericValues.length, notableSignal, recommendation: direction === "rising" ? "monitor-and-evaluate" : direction === "falling" ? "investigate-decline" : "continue-observation", explanation: `Latest value is ${direction} relative to the baseline using ${numericValues.length} supplied values.` } };
    },
  },
  {
    operation: "check_policy_update",
    requiredCapability: "policy_monitoring",
    execute(input) {
      const value = requireRecord(input, "check_policy_update");
      const previous = policySnapshot(value.previous, "previous");
      const current = policySnapshot(value.current, "current");
      const addedItems = Array.from(current.entries()).filter(([id]) => !previous.has(id)).map(([, text]) => text).sort();
      const removedItems = Array.from(previous.entries()).filter(([id]) => !current.has(id)).map(([, text]) => text).sort();
      const changedItems = Array.from(current.entries()).filter(([id, text]) => previous.has(id) && previous.get(id) !== text).map(([id, text]) => ({ id, from: previous.get(id), to: text })).sort((left, right) => left.id.localeCompare(right.id));
      const meaningfulChanges = addedItems.length > 0 || removedItems.length > 0 || changedItems.length > 0;
      const importance = removedItems.length > 0 || changedItems.length > 0 ? "high" : addedItems.length > 0 ? "medium" : "none";
      return { operation: "check_policy_update", output: { meaningfulChanges, addedItems, removedItems, changedItems, importance, summary: meaningfulChanges ? `${addedItems.length} added, ${removedItems.length} removed, ${changedItems.length} changed.` : "No meaningful policy changes detected." } };
    },
  },
  {
    operation: "quality_check",
    requiredCapability: "quality_assurance",
    execute(input) {
      const value = requireRecord(input, "quality_check");
      const data = requireRecord(value.data, "quality_check.data");
      const errors: string[] = [];
      const warnings: string[] = [];
      const checksPerformed: string[] = [];
      const requiredFields = Array.isArray(value.requiredFields) ? value.requiredFields.filter((field): field is string => typeof field === "string") : [];
      checksPerformed.push("required-fields");
      requiredFields.forEach((field) => { if (data[field] === undefined || data[field] === null || data[field] === "") errors.push(`Missing required field: ${field}`); });
      const uniqueFields = Array.isArray(value.uniqueFields) ? value.uniqueFields.filter((field): field is string => typeof field === "string") : [];
      checksPerformed.push("duplicate-values");
      uniqueFields.forEach((field) => { const fieldValue = data[field]; if (Array.isArray(fieldValue) && new Set(fieldValue.map((item) => JSON.stringify(item))).size !== fieldValue.length) errors.push(`Duplicate values found in: ${field}`); });
      const lengthLimits = value.lengthLimits && typeof value.lengthLimits === "object" ? value.lengthLimits as Record<string, unknown> : {};
      checksPerformed.push("length-limits");
      Object.entries(lengthLimits).forEach(([field, limit]) => { if (typeof limit === "number" && typeof data[field] === "string" && (data[field] as string).length > limit) warnings.push(`Length limit exceeded for: ${field}`); });
      const allowedValues = value.allowedValues && typeof value.allowedValues === "object" ? value.allowedValues as Record<string, unknown> : {};
      checksPerformed.push("allowed-values");
      Object.entries(allowedValues).forEach(([field, values]) => { if (Array.isArray(values) && data[field] !== undefined && !values.some((item) => Object.is(item, data[field]))) errors.push(`Invalid allowed value for: ${field}`); });
      const score = Math.max(0, 100 - errors.length * 25 - warnings.length * 10);
      return { operation: "quality_check", output: { pass: errors.length === 0, errors, warnings, checksPerformed, score } };
    },
  },
];

export function getInternalExecutionAdapter(operation: BoundedOperation): InternalExecutionAdapter | undefined {
  return adapters.find((adapter) => adapter.operation === operation);
}

export function listInternalExecutionAdapters(): InternalExecutionAdapter[] {
  return [...adapters];
}

export function runBoundedInternalOperation(operation: BoundedOperation, input: unknown): BoundedExecutionResult {
  const adapter = getInternalExecutionAdapter(operation);
  if (!adapter) throw new Error(`Unsupported bounded operation: ${operation}`);
  return adapter.execute(input);
}