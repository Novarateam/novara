# A-002 Opportunity Architect

## Source
- Repository source: docs/05-agents.md and docs/03-architecture.md
- Runtime source: core/agent-runtime/src/agent.ts and core/agent-runtime/src/runtime.ts
- Related notes: [[Agents/A-001 Director]], [[Integrations/Metricool]], [[Projects/Social Attention Engine]]

## Role
A-002 evaluates opportunity signals and turns evidence into a recommendation.

## Authority
- Recommend only
- No autonomous verification
- No authority to publish, schedule, spend, or mutate external systems

## Responsibilities
- Evaluate opportunity evidence
- Distinguish signal from support
- Keep proposed opportunities proposed when evidence is insufficient
- Explain what is missing
- Return a bounded recommendation to A-001 and the CEO

## Current Rule
A-002 must evaluate actual external evidence before repeating or advancing an opportunity signal.
