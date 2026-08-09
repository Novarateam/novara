# MCP

## Source
- Repository source: docs/08-integrations.md and docs/03-architecture.md
- Runtime source: core/agent-runtime/src/mcp/server.ts and core/agent-runtime/src/obsidian-mcp/server.ts
- Related notes: [[Integrations/Metricool]], [[Integrations/Obsidian]], [[Hermes]]

## Role
MCP is the integration transport for tool access.

## Current Authority Split
- Novara MCP: operational runtime
- Metricool MCP: external social evidence
- Obsidian MCP: read-only knowledge access

## Rules
- Least access
- Explicit permissions
- Auditability
- Read-only by default where possible
