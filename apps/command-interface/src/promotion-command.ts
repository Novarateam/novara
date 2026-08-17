import { AgentRuntime } from "../../../core/agent-runtime/src/runtime.ts";
import { FileRuntimeStore, RuntimeRepository } from "../../../core/agent-runtime/src/persistence.ts";
import { getAgentDefinitions } from "../../../core/agent-runtime/src/agent.ts";
import type { AgentPromotionResult } from "../../../core/agent-runtime/src/types.ts";
import { LocalPromotionAccessService, loadLocalPromotionAccessRules, type PromotionOperation } from "./promotion-access-service.ts";

export type PromotionCommand =
  | { operation: "createPromotionProposal"; proposalId?: string; agentId?: string; trustReportId?: string; governanceDecisionId?: string; promotionType?: string }
  | { operation: "confirmPromotion"; confirmationId?: string; proposalId?: string; reviewerId?: string; confirmation?: string }
  | { operation: "applyPromotion"; promotionId?: string; proposalId?: string; confirmationId?: string };

export interface PromotionWorkflow {
  createPromotionProposal(input: { proposalId: string; agentId: string; trustReportId: string; governanceDecisionId: string; promotionType: string }): AgentPromotionResult;
  confirmPromotion(input: { confirmationId: string; proposalId: string; reviewerId: string; confirmation: string }): AgentPromotionResult;
  applyPromotion(input: { promotionId: string; proposalId: string; confirmationId: string }): AgentPromotionResult;
  recordAccessAudit(input: { actorId: string; type: string; operation?: PromotionOperation; reason?: string }): void;
}

export type PromotionCommandResponse =
  | { status: "ok"; operation: PromotionCommand["operation"]; result: AgentPromotionResult }
  | { status: "invalid-request"; reason: string };

function defaultWorkflow(): PromotionWorkflow {
  const runtime = new AgentRuntime();
  const auditRepository = new RuntimeRepository(new FileRuntimeStore());
  for (const definition of getAgentDefinitions()) runtime.registerAgent(definition);
  return {
    createPromotionProposal: (input) => runtime.createPromotionProposal(input),
    confirmPromotion: (input) => runtime.confirmPromotion(input),
    applyPromotion: (input) => runtime.applyPromotion(input),
    recordAccessAudit: ({ actorId, type, operation, reason }) => auditRepository.appendAuditEvent({ actorId, type, message: "Promotion access rejected.", payload: { operation, reason } }),
  };
}

function appendDefaultAccessAudit(actorId: string, type: string, operation: PromotionOperation | undefined, reason: string): void {
  new RuntimeRepository(new FileRuntimeStore()).appendAuditEvent({ actorId, type, message: "Promotion access rejected.", payload: { operation, reason } });
}

function required(value: string | undefined, name: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function handlePromotionCommand(command: Partial<PromotionCommand>, credential: string | undefined, workflow: PromotionWorkflow | undefined = undefined, access = new LocalPromotionAccessService(loadLocalPromotionAccessRules())): PromotionCommandResponse {
  const operation = command.operation;
  const accessResult = access.authorize(operation, credential);
  if (accessResult.status !== "authorized") {
    const audit = { actorId: accessResult.status === "authorization-rejected" ? accessResult.identity : "unauthenticated", type: accessResult.status === "authentication-rejected" ? "promotion.authentication_rejected" : "promotion.authorization_rejected", operation, reason: accessResult.reason };
    if (workflow) workflow.recordAccessAudit(audit);
    else appendDefaultAccessAudit(audit.actorId, audit.type, audit.operation, audit.reason);
    return { status: "invalid-request", reason: accessResult.reason };
  }
  const activeWorkflow = workflow ?? defaultWorkflow();
  if (command.operation === "createPromotionProposal") {
    const proposalId = required(command.proposalId, "proposalId");
    const agentId = required(command.agentId, "agentId");
    const trustReportId = required(command.trustReportId, "trustReportId");
    const governanceDecisionId = required(command.governanceDecisionId, "governanceDecisionId");
    const promotionType = required(command.promotionType, "promotionType");
    if (!proposalId || !agentId || !trustReportId || !governanceDecisionId || !promotionType) return { status: "invalid-request", reason: "proposalId, agentId, trustReportId, governanceDecisionId, and promotionType are required." };
    return { status: "ok", operation: command.operation, result: activeWorkflow.createPromotionProposal({ proposalId, agentId, trustReportId, governanceDecisionId, promotionType }) };
  }
  if (command.operation === "confirmPromotion") {
    const confirmationId = required(command.confirmationId, "confirmationId");
    const proposalId = required(command.proposalId, "proposalId");
    const confirmation = required(command.confirmation, "confirmation");
    if (!confirmationId || !proposalId || !confirmation) return { status: "invalid-request", reason: "confirmationId, proposalId, and confirmation are required." };
    return { status: "ok", operation: command.operation, result: activeWorkflow.confirmPromotion({ confirmationId, proposalId, reviewerId: accessResult.identity, confirmation }) };
  }
  if (command.operation === "applyPromotion") {
    const promotionId = required(command.promotionId, "promotionId");
    const proposalId = required(command.proposalId, "proposalId");
    const confirmationId = required(command.confirmationId, "confirmationId");
    if (!promotionId || !proposalId || !confirmationId) return { status: "invalid-request", reason: "promotionId, proposalId, and confirmationId are required." };
    return { status: "ok", operation: command.operation, result: activeWorkflow.applyPromotion({ promotionId, proposalId, confirmationId }) };
  }
  return { status: "invalid-request", reason: "Unsupported promotion operation." };
}