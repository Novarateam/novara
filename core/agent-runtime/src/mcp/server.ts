import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { AgentRuntime } from "../runtime.ts";

export function createMcpServer(runtime: AgentRuntime) {
  const server = new Server(
    {
      name: "novara-runtime",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "getCompanyBrief",
        description: "Read the current company brief from Novara runtime memory and state.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "requestDirectorDecision",
        description: "Ask the Director layer to produce a structured decision for an objective.",
        inputSchema: {
          type: "object",
          properties: {
            objective: { type: "string" },
          },
          required: ["objective"],
        },
      },
      {
        name: "executeSpecialist",
        description: "Execute a specialist agent through the Novara runtime, currently limited to A-002.",
        inputSchema: {
          type: "object",
          properties: {
            agentId: { type: "string" },
            task: {
              type: "object",
              properties: {
                id: { type: "string" },
                objective: { type: "string" },
                input: { type: "object" },
              },
              required: ["id", "objective"],
            },
          },
          required: ["agentId", "task"],
        },
      },
      {
        name: "escalate",
        description: "Escalate a matter outside the current authority boundary to CEO attention.",
        inputSchema: {
          type: "object",
          properties: {
            reason: { type: "string" },
          },
          required: ["reason"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "getCompanyBrief": {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(runtime.getCompanyBrief(), null, 2),
            },
          ],
        };
      }
      case "requestDirectorDecision": {
        const objective = args?.objective as string | undefined;
        if (!objective) {
          throw new Error("objective is required");
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(runtime.requestDirectorDecision(objective), null, 2),
            },
          ],
        };
      }
      case "executeSpecialist": {
        const agentId = args?.agentId as string | undefined;
        const task = args?.task as { id?: string; objective?: string; input?: unknown } | undefined;
        if (!agentId || !task?.id || !task.objective) {
          throw new Error("agentId, task.id, and task.objective are required");
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(runtime.executeSpecialist(agentId, task as any), null, 2),
            },
          ],
        };
      }
      case "escalate": {
        const reason = args?.reason as string | undefined;
        if (!reason) {
          throw new Error("reason is required");
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(runtime.escalate(reason), null, 2),
            },
          ],
        };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });

  return server;
}

export async function startMcpServer(runtime: AgentRuntime) {
  const server = createMcpServer(runtime);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}
