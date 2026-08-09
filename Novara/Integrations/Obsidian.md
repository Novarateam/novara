# Obsidian

## Source
- Repository source: docs/03-architecture.md and docs/08-integrations.md
- Runtime source: core/agent-runtime/src/obsidian-mcp/server.ts
- Related notes: [[Integrations/MCP]], [[Strategy/Strategic Decisions]]

## Role
Obsidian is the durable human-readable institutional knowledge layer for Novara.

## Rules
- Read-only in this checkpoint
- No write-back yet
- No replacement for Company Memory or Company State
- No embeddings, vector search, or persistence architecture

## Current Vault
- Path: C:\Development\Novara\Novara
- Current purpose: curated institutional notes, not full operational state
