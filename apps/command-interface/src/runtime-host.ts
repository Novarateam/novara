import { getAgentDefinitions } from "../../../core/agent-runtime/src/agent.ts";
import { AgentRuntime } from "../../../core/agent-runtime/src/runtime.ts";

export type RuntimeHealth = {
  initialized: boolean;
  persistenceAvailable: boolean;
  startupId: string;
  startedAt: string;
  persistedSnapshotUpdatedAt: string | null;
  error: string | null;
};

export class RuntimeHost {
  private runtime: AgentRuntime | null = null;
  private error: Error | null = null;
  private readonly startupId = `runtime-host-${Date.now().toString(36)}`;
  private readonly startedAt = new Date().toISOString();

  constructor(storageRoot?: string) {
    try {
      const runtime = new AgentRuntime({ storageRoot });
      for (const definition of getAgentDefinitions()) {
        runtime.registerAgent(definition);
      }
      this.runtime = runtime;
    } catch (error) {
      this.error = error as Error;
    }
  }

  getRuntime(): AgentRuntime {
    if (!this.runtime) {
      throw new Error(`Runtime host is unavailable: ${this.error?.message ?? "startup failed"}`);
    }
    return this.runtime;
  }

  getHealth(): RuntimeHealth {
    if (!this.runtime) {
      return {
        initialized: false,
        persistenceAvailable: false,
        startupId: this.startupId,
        startedAt: this.startedAt,
        persistedSnapshotUpdatedAt: null,
        error: this.error?.message ?? "startup failed",
      };
    }

    return {
      initialized: true,
      persistenceAvailable: true,
      startupId: this.startupId,
      startedAt: this.startedAt,
      persistedSnapshotUpdatedAt: this.runtime.getPersistenceSnapshotUpdatedAt(),
      error: null,
    };
  }
}

export function createRuntimeHost(storageRoot?: string): RuntimeHost {
  return new RuntimeHost(storageRoot);
}
