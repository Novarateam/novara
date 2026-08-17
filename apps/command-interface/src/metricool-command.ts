import { checkMetricoolReadiness } from "../../../core/agent-runtime/src/metricool-adapter.ts";
import {
  MetricoolPreflightService,
  type MetricoolPreflightResult,
  type MetricoolPreflightStore,
} from "../../../core/agent-runtime/src/metricool-preflight-service.ts";
import { FileRuntimeStore, RuntimeRepository } from "../../../core/agent-runtime/src/persistence.ts";
import {
  LocalMetricoolAccessService,
  loadLocalMetricoolAccessRules,
  type MetricoolOperation,
} from "./metricool-access-service.ts";

export type MetricoolStatusResponse = {
  status: "ok";
  state: "not-configured" | "unavailable" | "ready";
  reason: string;
};

/** Pure read path: never mutates Runtime state, never creates a queue entry, never publishes. */
export async function handleMetricoolStatusCommand(): Promise<MetricoolStatusResponse> {
  const readiness = await checkMetricoolReadiness();
  return { status: "ok", state: readiness.state, reason: readiness.reason };
}

export type MetricoolPreflightCommand = {
  operation: MetricoolOperation;
  queueEntryId?: string;
};

export type MetricoolPreflightCommandResponse =
  | { status: "ok"; operation: MetricoolOperation; result: MetricoolPreflightResult }
  | { status: "invalid-request"; reason: string };

export interface MetricoolPreflightWorkflow extends MetricoolPreflightStore {
  appendAuditEvent: RuntimeRepository["appendAuditEvent"];
}

function defaultWorkflow(): MetricoolPreflightWorkflow {
  const repository = new RuntimeRepository(new FileRuntimeStore());
  return {
    getPublishingQueueEntry: (queueEntryId) => repository.getPublishingQueueEntry(queueEntryId),
    getMemoryEntry: (proposalId) => repository.getSnapshot().memory.find((entry) => entry.id === proposalId),
    getContentReviewDecisionByProposal: (proposalId) => repository.getContentReviewDecisionByProposal(proposalId),
    appendAuditEvent: (event) => repository.appendAuditEvent(event),
  };
}

/** The only path that may run a Metricool preflight check. Requires local access authorization. */
export async function handleMetricoolPreflightCommand(
  command: Partial<MetricoolPreflightCommand>,
  credential: string | undefined,
  workflow: MetricoolPreflightWorkflow = defaultWorkflow(),
  access = new LocalMetricoolAccessService(loadLocalMetricoolAccessRules()),
): Promise<MetricoolPreflightCommandResponse> {
  const operation = command.operation;
  const accessResult = access.authorize(operation, credential);
  if (accessResult.status !== "authorized") {
    workflow.appendAuditEvent({
      actorId: accessResult.status === "authorization-rejected" ? accessResult.identity : "unauthenticated",
      type: accessResult.status === "authentication-rejected" ? "metricool.authentication_rejected" : "metricool.authorization_rejected",
      message: "Rejected Metricool preflight access.",
      payload: { operation, reason: accessResult.reason },
    });
    return { status: "invalid-request", reason: accessResult.reason };
  }

  if (operation !== "preflightQueueEntry") {
    return { status: "invalid-request", reason: "Unsupported Metricool operation." };
  }

  const queueEntryId = command.queueEntryId?.trim();
  if (!queueEntryId) {
    return { status: "invalid-request", reason: "queueEntryId is required." };
  }

  const service = new MetricoolPreflightService(workflow);
  const result = await service.preflight(queueEntryId);

  workflow.appendAuditEvent({
    actorId: accessResult.identity,
    type: "metricool.preflight_checked",
    message: "Ran Metricool publishing preflight check.",
    payload: { queueEntryId, status: result.status },
  });

  return { status: "ok", operation, result };
}
