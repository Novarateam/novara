# Novara

Novara is an autonomous operating system for creating, operating, and scaling digital businesses.

Our mission is to build systems that automate execution, learn continuously, and enable the creation of profitable businesses with minimal manual intervention.

## Vision

Build the world's leading autonomous business platform.

## Principles

- Automation over repetition
- Systems over hacks
- Quality over quantity
- Providers are replaceable
- Everything is measurable
- Continuous learning
- Human-guided autonomy

---

This repository contains the foundation of Novara.

Status: Foundation Phase

## Runtime and MCP status

- The core runtime now owns in-memory company memory and state.
- A-001 and A-002 continue to execute through the runtime with shared context.
- A minimal MCP server is available at [core/agent-runtime/src/mcp/cli.ts](core/agent-runtime/src/mcp/cli.ts) with four tools: getCompanyBrief, requestDirectorDecision, executeSpecialist, and escalate.
- Verification commands:
  - node --experimental-strip-types .\core\agent-runtime\src\index.ts
  - node --experimental-strip-types .\core\agent-runtime\src\mcp\cli.ts
  - node --input-type=module --experimental-strip-types -e "import { Client } from '@modelcontextprotocol/sdk/client/index.js'; import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'; const transport = new StdioClientTransport({ command: process.execPath, args: ['--experimental-strip-types', 'core/agent-runtime/src/mcp/cli.ts'], cwd: process.cwd() }); const client = new Client({ name: 'novara-test', version: '1.0.0' }, { capabilities: {} }); await client.connect(transport); const tools = await client.listTools(); console.log(JSON.stringify({ tools: tools.tools.map((tool) => tool.name) }, null, 2)); const brief = await client.callTool({ name: 'getCompanyBrief', arguments: {} }); console.log(brief.content[0].text); await client.close();"
