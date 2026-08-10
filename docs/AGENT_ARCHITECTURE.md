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

## Current Limitations

- Hermes is not yet creating runtime tasks.
- Agent-to-agent communication is not yet a general message bus.
- Memory is not yet fully layered into global/company/department/agent/task behavior.
- PermissionPolicy exists as a schema but formal risk/approval rules are not yet implemented.
- Dynamic agent spawning is not implemented.
- Cost tracking is not implemented.
