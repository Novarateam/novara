# Novara Agent Architecture (Current Foundation)

Date: 2026-08-10

## Current Architecture

### AgentProfile
Canonical persisted profile for each registered agent. Captures identity, mission, authority, workload, limits, metrics, performance, and cumulative cost fields.

### Department
Canonical schema exists for department identity, mission, membership, goals, metrics, memory references, and budget fields.

### TaskRecord
Durable task lifecycle record with stable ID, timestamps, assigned agent, priority, status, input, result/error, cost, and evidence references.

### MessageEnvelope
Structured agent-to-agent message record with stable ID, sender, recipient, task ID, priority, payload, and timestamp.

### MemoryScope
Canonical schema for scoped memory namespaces (novara, company, department, agent, task).

### PermissionPolicy
Canonical schema for subject-level policy (agent/department), allowed authorities, approval-required authorities, and risk-level metadata.

### AuditEvent
Append-only runtime audit record with stable ID, timestamp, actor, optional task ID, event type, message, and payload.

### RuntimeStore
Persistence interface abstraction for loading/saving runtime snapshot and appending audit events.

### RuntimeRepository
Repository facade used by runtime logic to persist and query runtime entities without coupling runtime code to storage implementation details.

### FileRuntimeStore
Current concrete RuntimeStore implementation using local durable files:
- Snapshot: state.json
- Append-only events: audit.log

### .novara/runtime
Local runtime persistence root used by FileRuntimeStore. Intended for local durable state and audit records.

## Brain and Agent Foundation

### AgentDefinition and AgentProfile
AgentDefinition is the immutable operational contract: identity, mission, capabilities, inputs, outputs, authority level, approval requirements, limitations, declared performance signals, and execution state. AgentProfile is the persisted mutable operating state: workload, performance counters, cost, timestamps, and operational references. Legacy snapshots are normalized with safe defaults.

### AgentRegistry
The registry validates definitions, persists profiles through RuntimeRepository, lists registered agents, and selects only implemented, active, available agents whose capability and authority meet a routing request. Registered planned agents are organizational records, not executable candidates.

### NovaraBrain
NovaraBrain is a small composition facade over company memory, company state, scoped context, the agent registry, decision memory, and coordination. AgentRuntime remains the execution boundary and compatibility facade.

### Coordination and Decisions
Coordination produces auditable typed routing results without executing work automatically. Structured decision records are stored as existing durable `decision` memory entries, retaining owner, alternatives, rationale, supporting evidence, approval state, timestamps, and revisitable status.

### Learning Foundation
The runtime can record outcome and feedback entries with task/agent references and declared performance signals. It does not alter authority, create agents, or modify itself from those records.

### Action-Level Permission and Approval
PermissionEngine evaluates typed action requests through the registered agent contract, persisted PermissionPolicy, declared capabilities, action scope, impact, and approval requirements. It returns an allowed, approval-required, denied, or escalation-required decision without executing an action. Approval-required decisions create durable pending ApprovalRecord entries and audit events; pending is never treated as approved. Self-authority changes, autonomous agent creation/activation, and permission-engine modification are denied.

### Initial Authority Policy
The initial Novara authority model is intentionally narrow and explicit:

#### HERMES
- Coordinator and interface only
- May read from connected systems
- May delegate work to agents
- May not spend money
- May not publish, schedule, delete, modify, or commit anything without explicit approval

#### A-001 DIRECTOR
- Strategic coordinator
- May evaluate evidence and recommend actions
- May delegate within routed work boundaries
- May not spend, publish, schedule, delete, or make irreversible external changes
- CEO approval is required for consequential actions

#### A-002 OPPORTUNITY ARCHITECT
- Research and opportunity discovery only
- May read external evidence
- May create recommendations and proposed opportunities
- May not verify an opportunity solely from generated reasoning
- May not execute external actions

#### OTHER SPECIALIST AGENTS
- Default to read-only access
- Receive only the tools required for their specific job
- Have no broad access to all MCP tools
- Have no write authority by default

#### CEO
- Final authority for strategic decisions
- Must explicitly approve consequential external actions

This policy is the default starting point for authority decisions. Any broader access must be granted explicitly and separately.

### Human Approval Decisions
ApprovalService supports explicit one-way human decisions through runtime APIs. A non-empty approver identity can transition only a pending request to approved or rejected; a request found expired during a decision attempt transitions to expired. Final states cannot be overwritten, missing records are never created, and every decision is audited. Approval changes authorization state only and never executes the underlying action.

### Permission-Gated Task Handoff
TaskHandoffService converts authoritative persisted permission evidence into a durable queued TaskRecord. Handoff is permitted only for an allowed action or an approval-required action with a matching approved approval record. The task retains compact action, capability, permission, and approval references for future execution. Handoff does not start, execute, complete, or fail the task.

### Task Claim and Execution Readiness
TaskClaimService revalidates a queued task's persisted action with PermissionEngine, current registry eligibility, and approval linkage before transitioning it to `claimed`. Claimed tasks record a claiming agent and execution-readiness timestamps only. They remain non-running and no executor, provider, or external capability is invoked.

### A-012 Trend Monitor
A-012 is the first promoted intelligence agent. It operates in `observed` status with only the `trend_monitoring` capability and accepts structured trend values already supplied to the runtime. Through the normal permission, handoff, claim, and final authorization chain, it may run the deterministic `analyse_trend` adapter to produce direction, momentum, notable signal, confidence, recommendation, and data-sufficiency output. It cannot research externally, access providers, fetch live trends, publish, communicate, spend, or take strategic action. Its persisted profile metrics track tasks received, completed, failed/rejected, total values processed, and average deterministic trend confidence.

### Intelligence Evaluation Framework
Intelligence evaluation uses controlled internal cases through the same route → permission → handoff → claim → final authorization → bounded adapter path as normal work. Reports persist independently from operational metrics. For A-012, the corpus covers clear rising, falling, flat, noisy, spike, reversal, and ambiguous signals. Each result is scored deterministically: direction accuracy 35 points, momentum interpretation 20, recommendation 20, and confidence-range quality 25. Evaluation-quality metrics record report count, cases, passed cases, average score, direction accuracy, recommendation accuracy, and confidence quality. These scores are performance evidence only: they never change authority, permissions, approval requirements, activation, or external access.

### Trust and Performance
Trust reports aggregate durable operational outcomes, controlled evaluation reports, and read-only attributable governance audit evidence. Component scores are controlled quality 40, confidence calibration 15, operational reliability 30, and governance safety 15. Assessment levels are `unproven`, `observed`, `developing`, `demonstrated`, and `proven`; they are not lifecycle or authority levels. Reports explicitly mark insufficient or unavailable evidence, and human approval rejection alone is never treated as agent misconduct. Generated reports are immutable historical evidence with human review recommendations only. A trust score is evidence, a trust level is an assessment, and any autonomy change remains a separate explicit human-governed decision.

### Read-Only Human Trust Review
HumanTrustReviewService exposes immutable trust reports for visibility only: all reports, reports for one agent, one report by ID, and a latest-report review summary. Report lists are ordered newest `generatedAt` first, then report ID. The local GET-only `/api/trust-review` adapter accepts exactly `listTrustReports`, `getTrustReport`, and `getAgentTrustReview`; it reads persisted reports without constructing mutable Runtime/Brain command context. `humanReviewEligible` means only that the latest immutable recommendation is `eligible-for-human-review`; it does not approve, promote, activate, authorize, or grant anything. The governance boundary is absolute: trust evidence → immutable trust report → read-only human review visibility → separate future human governance decision. There is no path from a trust score to automatic promotion, authority, permission, capability, or external-access change.

### Immutable Human Governance Decisions
After reviewing immutable trust evidence, a human may record one of four immutable judgements: `continue-observation`, `needs-more-evidence`, `approved-for-human-review`, or `rejected-for-now`. Each record links an agent, immutable trust report, explicit reviewer identity, timestamp, and optional reason. Historical decisions are appended, never edited or replaced; later judgement creates a new record. `approved-for-human-review` records only a human judgement that evidence is sufficient for a separate future governance stage. It does not promote, activate, authorize, grant capabilities, change policy, create work, or execute anything.

### Explicit Human-Governed Promotion
The first promotion workflow is deliberately narrow: immutable trust report + immutable `approved-for-human-review` governance decision -> authenticated `createPromotionProposal` -> immutable `observed-to-trusted` proposal -> separately authenticated `confirm-promotion` confirmation -> separately authenticated `applyPromotion` -> controlled application. The local POST `/api/agent-promotion` adapter accepts exactly `createPromotionProposal`, `confirmPromotion`, and `applyPromotion`; it is a thin validated boundary over the existing Runtime workflow and cannot directly modify an agent. Local promotion access is fail-closed and configured server-side through `NOVARA_PROMOTION_LOCAL_ACCESS`; each configured identity has an explicit allowlist for one or more of the three operations, and the authenticated identity replaces any body-supplied reviewer identity during confirmation. Proposal is not confirmation, confirmation is not application, and only application can change the existing agent lifecycle field from `observed` to `trusted`. Promotion cannot change authority, execution state, capabilities, policies, approval requirements, external access, task behavior, or execution scope. Each proposal, confirmation, and applied promotion is immutable history; a proposal may be applied only once. This remains a controlled local boundary only; production authentication and authorization remain a separate future layer.

### Bounded Execution Attempts
The current authorization chain is: route → permission → approval when required → handoff → claim → claim-time revalidation → final execution-time revalidation → bounded internal execution → result/audit. ExecutionAttemptService accepts only claimed tasks and routes a final authorized operation to an explicit internal adapter. The allowlist is `analyse_text`, `score_opportunity`, `validate_data`, `analyse_trend`, `check_policy_update`, and `quality_check`; new trend, policy, and QA adapters require `trend_monitoring`, `policy_monitoring`, and `quality_assurance` capabilities respectively. It records execution attempt/result evidence and transitions only successful operations to completed. Novara has no general autonomous execution: providers, integrations, networks, publishing, external communication, finance, and system modification remain outside this executor and require separate capability-specific boundaries.

## Current Limitations

- Hermes is not yet creating runtime tasks.
- Memory is not yet fully layered into global/company/department/agent/task behavior.
- The action-level engine provides conservative initial policy only; it does not yet include a human approval UI, expiry worker, or action execution layer.
- Agent creation remains human-controlled; dynamic agent spawning is not implemented.
- Cost tracking is not implemented.
