import type { CompanyState } from "./types.ts";

export class CompanyStateStore {
  private state: CompanyState = {
    objectives: [],
    priorities: [],
    activeWork: [],
    opportunities: [],
    risks: [],
    pendingDecisions: [],
    lastUpdated: new Date().toISOString(),
  };

  getState(): CompanyState {
    return {
      objectives: [...this.state.objectives],
      priorities: [...this.state.priorities],
      activeWork: [...this.state.activeWork],
      opportunities: [...this.state.opportunities],
      risks: [...this.state.risks],
      pendingDecisions: [...this.state.pendingDecisions],
      lastUpdated: this.state.lastUpdated,
    };
  }

  updateState(partialState: Partial<CompanyState>): CompanyState {
    const nextState: CompanyState = {
      objectives: partialState.objectives ?? [...this.state.objectives],
      priorities: partialState.priorities ?? [...this.state.priorities],
      activeWork: partialState.activeWork ?? [...this.state.activeWork],
      opportunities: partialState.opportunities ?? [...this.state.opportunities],
      risks: partialState.risks ?? [...this.state.risks],
      pendingDecisions: partialState.pendingDecisions ?? [...this.state.pendingDecisions],
      lastUpdated: new Date().toISOString(),
    };

    this.state = nextState;
    return this.getState();
  }
}
