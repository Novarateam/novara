# Novara Integrations

## 01. Purpose

Integrations connect Novara to external systems, platforms, services and data sources.

Integrations provide access to the outside world without allowing external providers to define Novara's internal architecture.

An integration is an implementation detail.

The Novara capability it supports is the stable interface.

> **Novara chooses what it needs to do. Integrations determine how it connects to the outside world.**

---

# 02. Integration Principles

### 02.01 Provider independence

Novara should avoid unnecessary dependence on a single external provider.

Where practical:

```text
agent
  ↓
capability
  ↓
integration
  ↓
provider
```

A provider can be replaced without redesigning the agent.

---

### 02.02 Least access

Every integration receives only the permissions required for its purpose.

An integration should not have broad access simply because the provider makes it available.

---

### 02.03 Explicit permissions

Every integration must define:

* what it can access
* what it can change
* what it can create
* what it can delete
* which agents may use it
* which actions require approval

---

### 02.04 Auditability

External actions should be traceable.

Where appropriate, Novara should record:

* integration
* provider
* action
* requesting agent
* timestamp
* authorization
* relevant input
* result
* error
* external reference

---

### 02.05 Failure awareness

External services can fail.

Novara must distinguish between:

* provider unavailable
* authentication failure
* permission failure
* rate limit
* invalid request
* provider error
* network failure
* unknown failure

An integration must never report success when the external action did not succeed.

---

# 03. Integration Categories

Initial integration categories include:

### 03.01 Social platforms

Platforms used for:

* content publishing
* audience data
* content performance
* account management

Examples may include:

* Instagram
* TikTok
* YouTube
* other relevant platforms

---

### 03.02 Content creation

External systems used for:

* text generation
* image generation
* video generation
* voice generation
* music
* editing
* media processing

---

### 03.03 Research and data

Systems used for:

* web research
* search
* structured data
* market intelligence
* analytics
* external information

---

### 03.04 Analytics

Systems used for:

* platform analytics
* business metrics
* attribution
* experimentation
* reporting

---

### 03.05 Publishing and scheduling

Systems used to:

* schedule content
* publish content
* manage multiple platforms
* monitor publishing status

---

### 03.06 Communication

Systems used for:

* notifications
* email
* internal communication
* human approvals
* alerts

---

### 03.07 Infrastructure

Systems providing:

* compute
* storage
* databases
* queues
* authentication
* monitoring
* deployment

---

# 04. Integration Registry

Every integration should have a registry entry.

Minimum structure:

```text
integration_id
name
provider
category
status
version
capabilities
permissions
authentication
data_access
actions
rate_limits
cost
fallbacks
health
owner
```

Example:

```text
integration_id: INT-001

name:
social-publishing-provider

provider:
example provider

category:
social distribution

status:
planned

capabilities:
- create_post
- schedule_post
- publish_post
- retrieve_post_metrics

permissions:
- publish
- read analytics

actions:
- create
- update
- publish

health:
monitored
```

---

# 05. Integration Status

Integrations follow a lifecycle:

```text
proposed
    ↓
evaluating
    ↓
approved
    ↓
developing
    ↓
testing
    ↓
active
    ↓
degraded
    ↓
deprecated
    ↓
retired
```

---

# 06. Authentication

Credentials and secrets must never be hardcoded into application logic.

Authentication should use appropriate secure mechanisms.

Secrets must be:

* securely stored
* access controlled
* auditable where appropriate
* rotated where appropriate
* separated from source code

Agents should not directly receive credentials unless explicitly required and authorized.

---

# 07. Permission Model

Permissions should exist at multiple levels.

```text
Novara
  ↓
application
  ↓
agent
  ↓
capability
  ↓
integration
  ↓
specific external action
```

The system should enforce the narrowest appropriate permission.

Example:

```text
distribution agent
    ↓
publish_post capability
    ↓
social integration
    ↓
approved account
    ↓
approved platform
```

---

# 08. External Actions

External actions require additional caution because they affect reality outside Novara.

Examples:

* publishing content
* sending messages
* spending money
* modifying accounts
* deleting data
* changing configuration
* creating external commitments

The required authority should depend on:

* impact
* risk
* reversibility
* agent trust
* action type

---

# 09. Human Approval

During the initial phase, high-impact external actions may require human approval.

Approval requirements should decrease only when the relevant agent and workflow demonstrate sufficient reliability.

The objective is not maximum approval.

The objective is:

> **Maximum safe autonomy.**

---

# 10. Provider Selection

Where multiple providers can satisfy a capability, Novara may evaluate:

* quality
* reliability
* cost
* latency
* availability
* security
* privacy
* geographic requirements
* rate limits
* strategic dependence

Provider selection should be based on evidence.

---

# 11. Provider Failover

Where practical, Novara should support alternative providers.

Example:

```text
primary provider
      ↓
failure
      ↓
capability detects failure
      ↓
fallback provider
      ↓
continue
```

Failover should only occur when the alternative satisfies the requirements of the requested capability.

A lower-quality fallback should not silently produce an output that violates the expected quality standard.

---

# 12. Integration Health

Novara should monitor integration health.

Relevant signals include:

* availability
* latency
* error rate
* authentication status
* rate limits
* cost
* provider changes
* output quality

Integration degradation should be visible to the Conductor and relevant agents.

---

# 13. Data Flow

Data entering Novara through integrations should retain appropriate provenance.

Where practical, Novara should know:

```text
source
provider
timestamp
data type
freshness
confidence
transformation
destination
```

This is particularly important for information used in decisions.

---

# 14. Data Minimization

Novara should only retrieve and retain information required for a legitimate purpose.

External data should not be collected simply because it is accessible.

Retention should reflect:

* usefulness
* sensitivity
* legal requirements
* operational requirements
* memory requirements

---

# 15. Integration vs Capability

The distinction must remain clear.

### Capability

What Novara can do.

Example:

```text
publish_post
```

### Integration

How Novara connects to an external system to do it.

Example:

```text
social publishing integration
```

### Provider

The external service implementing that integration.

Example:

```text
provider
```

Therefore:

```text
agent
   ↓
capability
   ↓
integration
   ↓
provider
```

---

# 16. Integration vs Agent

Agents must not be designed around individual integrations.

Bad:

```text
TikTok Agent
```

when the real responsibility is:

```text
distribution
```

Better:

```text
distribution agent
      ↓
publish_content capability
      ↓
social integration
      ↓
TikTok
```

The agent's mission remains stable even if the provider changes.

---

# 17. Initial Socials Integrations

The first Socials implementation should evaluate integrations for:

### Social platforms

* Instagram
* TikTok
* YouTube

### Content creation

* text generation
* image generation
* video generation
* voice generation
* media processing

### Research

* web search
* information sources
* trend data

### Analytics

* social analytics
* content performance
* audience analytics

### Publishing

* scheduling
* publishing
* content management

These are requirements to evaluate, not assumptions that every provider should immediately be integrated.

---

# 18. Integration Evaluation

Before adopting an external provider, Novara should evaluate:

* capability fit
* API quality
* reliability
* pricing
* rate limits
* permissions
* security
* data handling
* scalability
* provider lock-in
* replacement difficulty

A provider should earn its place in the architecture.

---

# 19. Integration Failure

If an integration fails:

1. Detect the failure.
2. Record the failure.
3. Determine whether retry is safe.
4. Retry where appropriate.
5. Use a fallback where appropriate.
6. Escalate when necessary.
7. Never claim the external action succeeded without verification.

---

# 20. Integration Changes

Provider changes should not require unnecessary changes to agents.

If a provider is replaced:

```text
old provider
    ↓
integration updated
    ↓
capability remains stable
    ↓
agents continue operating
```

Major provider changes should be recorded in `09-decisions.md` when they materially affect Novara.

---

# 21. Integration Security

External integrations represent potential attack and failure surfaces.

Novara should protect against:

* credential leakage
* unauthorized actions
* excessive permissions
* malicious external data
* compromised providers
* unexpected API behavior
* injection through external content
* accidental destructive actions

External data should never automatically become trusted organizational knowledge.

---

# 22. Integration Principle

> **Connect broadly. Depend carefully. Verify externally.**

Novara should be able to use the world's best tools without allowing any single provider to become the foundation of Novara itself.

---

# 23. Foundational Rule

Integrations exist to extend Novara's capabilities.

They do not define Novara's identity, mission or architecture.

Providers can disappear.

Platforms can change.

APIs can change.

Capabilities can evolve.

Agents can be replaced.

**Novara must remain.**

---

# 24. Checkpoint Record

## 24.01 Metricool Read-Only Integration Checkpoint (2026-08-09)

Status:

* completed

Scope:

* Hermes native MCP registration for Metricool confirmed
* integration verified with read-only evidence retrieval only
* no publish, schedule, edit, delete, or spend actions performed

Evidence summary:

* MCP connectivity verified
* read-only analytics and best-time evidence retrieved for the Socials growth sprint context
* mutating tools were intentionally not used during verification
