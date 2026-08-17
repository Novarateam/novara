import type {
  ApprovalDecisionRequest,
  ApprovalDecisionResult,
  ApprovalRecord,
} from "./types.ts";

type ApprovalDecision = "approved" | "rejected";

export class ApprovalService {
  private readonly getApproval: (approvalId: string) => ApprovalRecord | undefined;

  constructor(getApproval: (approvalId: string) => ApprovalRecord | undefined) {
    this.getApproval = getApproval;
  }

  approve(request: ApprovalDecisionRequest): ApprovalDecisionResult {
    return this.decide(request, "approved");
  }

  reject(request: ApprovalDecisionRequest): ApprovalDecisionResult {
    return this.decide(request, "rejected");
  }

  private decide(request: ApprovalDecisionRequest, decision: ApprovalDecision): ApprovalDecisionResult {
    const decidedAt = new Date().toISOString();
    const approvalId = String(request.approvalId ?? "").trim();
    const approverId = String(request.approverId ?? "").trim();

    if (!approvalId || !approverId) {
      return {
        status: "invalid-request",
        approvalId,
        reason: "Approval decisions require a non-empty approvalId and approverId.",
        decidedAt,
      };
    }

    const approval = this.getApproval(approvalId);
    if (!approval) {
      return {
        status: "not-found",
        approvalId,
        reason: "Approval request was not found.",
        decidedAt,
      };
    }

    if (approval.status !== "pending") {
      return {
        status: "already-decided",
        approvalId,
        reason: `Approval request is already ${approval.status} and cannot be changed.`,
        approval,
        decidedAt,
      };
    }

    if (approval.expiresAt && Date.parse(approval.expiresAt) <= Date.now()) {
      const expired: ApprovalRecord = {
        ...approval,
        status: "expired",
        decidedAt,
        reason: "Approval request expired before a human decision was recorded.",
      };
      return {
        status: "expired",
        approvalId,
        reason: expired.reason,
        approval: expired,
        decidedAt,
      };
    }

    const reason = request.reason?.trim() || (decision === "approved" ? "Approved by human operator." : "Rejected by human operator.");
    const updated: ApprovalRecord = {
      ...approval,
      status: decision,
      approvedBy: approverId,
      decidedAt,
      reason,
    };
    return {
      status: decision,
      approvalId,
      reason,
      approval: updated,
      decidedAt,
    };
  }
}