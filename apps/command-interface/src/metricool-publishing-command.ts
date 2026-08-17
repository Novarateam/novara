import { FileRuntimeStore, RuntimeRepository } from "../../../core/agent-runtime/src/persistence.ts";
import { MetricoolPublishingAdapter } from "../../../core/agent-runtime/src/metricool-publishing-adapter.ts";
import { MetricoolPublishingService, type MetricoolPublishingStore } from "../../../core/agent-runtime/src/metricool-publishing-service.ts";
import { LocalMetricoolPublishingAccessService, loadLocalMetricoolPublishingAccessRules, type MetricoolPublishingOperation } from "./metricool-publishing-access-service.ts";

export interface MetricoolPublishingCommand {
  operation: MetricoolPublishingOperation;
  queueEntryId?: string;
}

export type MetricoolPublishingCommandResponse =
  | { status: "ok"; operation: MetricoolPublishingOperation; result: Awaited<ReturnType<MetricoolPublishingService["execute"]>> }
  | { status: "invalid-request"; reason: string };

function defaultWorkflow(): MetricoolPublishingStore {
  const repository = new RuntimeRepository(new FileRuntimeStore());
  return {
    getPublishingQueueEntry: (queueEntryId) => repository.getPublishingQueueEntry(queueEntryId),
    getMemoryEntry: (proposalId) => repository.getSnapshot().memory.find((entry) => entry.id === proposalId),
    getContentReviewDecisionByProposal: (proposalId) => repository.getContentReviewDecisionByProposal(proposalId),
    claimPublishingQueueEntry: (queueEntryId, entry) => repository.claimPublishingQueueEntry(queueEntryId, entry),
    updatePublishingQueueEntry: (queueEntryId, expectedStatus, entry) => repository.updatePublishingQueueEntry(queueEntryId, expectedStatus, entry),
    appendAuditEvent: (event) => repository.appendAuditEvent(event),
  };
}

export async function handleMetricoolPublishingCommand(
  command: Partial<MetricoolPublishingCommand>,
  credential: string | undefined,
  workflow: MetricoolPublishingStore = defaultWorkflow(),
  access = new LocalMetricoolPublishingAccessService(loadLocalMetricoolPublishingAccessRules()),
  adapter = new MetricoolPublishingAdapter(),
): Promise<MetricoolPublishingCommandResponse> {
  const accessResult = access.authorize(command.operation, credential);
  if (accessResult.status !== "authorized") {
    workflow.appendAuditEvent({
      actorId: accessResult.status === "authorization-rejected" ? accessResult.identity : "unauthenticated",
      type: accessResult.status === "authentication-rejected" ? "metricool.publishing_authentication_rejected" : "metricool.publishing_authorization_rejected",
      message: "Rejected Metricool publishing access.",
      payload: { operation: command.operation, reason: accessResult.reason },
    });
    return { status: "invalid-request", reason: accessResult.reason };
  }
  if (command.operation !== "publishQueueEntry") {
    return { status: "invalid-request", reason: "Unsupported Metricool publishing operation." };
  }
  const queueEntryId = command.queueEntryId?.trim();
  if (!queueEntryId) return { status: "invalid-request", reason: "queueEntryId is required." };

  const result = await new MetricoolPublishingService(workflow, adapter).execute(queueEntryId);
  workflow.appendAuditEvent({
    actorId: accessResult.identity,
    type: "metricool.publish_attempted",
    message: "Executed explicit Metricool publishing command.",
    payload: { queueEntryId, status: result.status },
  });
  return { status: "ok", operation: command.operation, result };
}
