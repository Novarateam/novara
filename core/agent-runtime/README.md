# agent runtime

## 01. purpose

The agent runtime is the execution environment shared by all Novara agents.

It provides the common mechanisms required for an agent to operate safely and consistently.

Individual agents define **what they are responsible for**.

The runtime defines **how they operate**.

---

## 02. responsibilities

The runtime is responsible for:

* loading an agent
* establishing its identity
* loading its mission and configuration
* providing authorized capabilities
* providing relevant memory
* enforcing authority
* managing agent execution
* recording actions
* recording results
* handling failures
* handling escalation
* reporting performance events
* stopping execution safely

---

## 03. execution model

The initial execution model is:

```text
task
  ↓
runtime
  ↓
load agent
  ↓
load identity
  ↓
load mission
  ↓
load authority
  ↓
load context
  ↓
agent reasoning
  ↓
capability request
  ↓
authority check
  ↓
capability execution
  ↓
result
  ↓
agent evaluation
  ↓
output
  ↓
performance event
  ↓
memory / learning
```

---

## 04. agent isolation

Each agent operates within its defined authority.

An agent should not automatically have access to:

* every capability
* every memory
* every integration
* every other agent
* organizational configuration
* sensitive information

Access must be explicitly granted.

---

## 05. capability access

Agents request capabilities through the runtime.

Example:

```text
agent
  ↓
runtime
  ↓
capability request
  ↓
authority check
  ↓
capability
```

The agent does not directly bypass the runtime to access providers.

---

## 06. communication

Agent-to-agent communication should pass through controlled interfaces.

Example:

```text
opportunity
  ↓
runtime
  ↓
request
  ↓
research
```

Communication should be:

* identifiable
* structured
* auditable
* attributable
* permission-aware

---

## 07. authority enforcement

The runtime must enforce authority independently of the agent's own reasoning.

An agent saying:

> "I am allowed to do this"

is not sufficient.

The runtime must determine whether the action is authorized.

---

## 08. action records

Important actions should generate structured records containing:

* agent
* action
* capability
* timestamp
* authority
* input reference
* output reference
* result
* error if applicable

These records support:

* debugging
* auditing
* performance
* learning
* accountability

---

## 09. failure handling

If an agent fails, the runtime should distinguish between:

* agent failure
* capability failure
* integration failure
* provider failure
* infrastructure failure
* authorization failure
* unknown failure

The runtime must not convert an unsuccessful action into a successful result.

---

## 10. escalation

The runtime must allow an agent to escalate when:

* authority is insufficient
* information is insufficient
* risk is too high
* required capabilities are unavailable
* another agent is required
* a critical error occurs
* human judgment is required

---

## 11. execution boundaries

Agents should operate within explicit boundaries.

A runtime execution should have:

* start
* context
* objective
* authority
* available capabilities
* resource limits
* completion condition
* timeout
* result
* termination state

---

## 12. termination

An agent execution should terminate when:

* the task is completed
* the task cannot safely continue
* authority is exhausted
* resources are exhausted
* a critical error occurs
* the agent escalates
* a timeout is reached

The runtime should never allow uncontrolled execution.

---

## 13. observability

The runtime should make execution observable.

At minimum, Novara should eventually be able to determine:

```text
what ran?
which agent?
why?
with what authority?
what did it use?
what did it do?
what happened?
what did it cost?
what was learned?
```

---

## 14. performance integration

The runtime produces events that can be consumed by the Performance System.

The runtime does not determine the final performance score.

It provides evidence.

Example:

```text
runtime event
  ↓
performance system
  ↓
performance dimension
  ↓
current performance
  ↓
trajectory
```

---

## 15. memory integration

The runtime provides agents with access to appropriate memory.

Memory access must respect:

* authority
* relevance
* privacy
* organizational boundaries

The runtime should allow important learning to be returned to organizational memory.

---

## 16. autonomy

The runtime must support different authority levels.

An agent may operate as:

```text
observe
recommend
execute_with_approval
autonomous
delegate
```

The runtime enforces the current level.

Agents cannot promote themselves.

---

## 17. human approval

When approval is required:

```text
agent
  ↓
runtime
  ↓
approval request
  ↓
human / aios
  ↓
approved or rejected
  ↓
runtime
  ↓
continue or terminate
```

Approval must be recorded.

---

## 18. resource controls

The runtime should eventually enforce limits on:

* execution time
* compute
* API usage
* financial expenditure
* number of actions
* concurrency
* memory access

Resource limits should be appropriate to the agent's authority and mission.

---

## 19. runtime principle

The runtime should make the safe path the easy path.

Agents should be able to operate efficiently without bypassing governance.

The runtime exists to provide:

**freedom within boundaries.**

---

## 20. foundational rule

Every Novara agent should run through the same fundamental runtime principles.

Agents may be radically different.

Their execution environment should remain consistent enough that Novara can:

* observe them
* evaluate them
* control them
* improve them
* replace them
* scale them

without redesigning the organization around each individual agent.
