# Novara Development Standards

## 01. Purpose

These standards define how Novara is designed, built, tested, changed and maintained.

The objective is to build software that is:

* reliable
* transparent
* maintainable
* secure
* scalable
* observable
* replaceable
* testable
* continuously improvable

Development quality is part of Novara's culture, not a separate concern.

---

# 02. Build What Is Real

Novara must never represent an unverified capability as working.

Before claiming that something works, the system should verify it.

The development process is:

```text
understand
    ↓
design
    ↓
build
    ↓
test
    ↓
verify
    ↓
observe
    ↓
improve
```

A feature is not considered complete because code exists.

It is complete when the intended behavior has been demonstrated.

> **Never confuse implementation with functionality.**

---

# 03. Truth Over Appearance

Development must follow the Constitution.

If something does not work:

* say so
* identify the failure
* investigate the cause
* document relevant limitations
* find the best available solution
* continue forward

Never hide technical failures to make progress appear greater than it is.

> **Expose failure. Solve forward.**

---

# 04. Small Changes, Strong Foundations

Changes should be made in controlled increments.

Prefer:

```text
small change
    ↓
test
    ↓
verify
    ↓
commit
    ↓
next change
```

over making large numbers of unverified changes simultaneously.

This makes failures easier to identify and reverse.

---

# 05. Source of Truth

Every important concept should have one authoritative location.

Examples:

```text
constitution
    → 02-constitution.md

architecture
    → 03-architecture.md

roadmap
    → 04-roadmap.md

agents
    → 05-agents.md

capabilities
    → 06-capabilities.md

dashboard
    → 07-dashboard.md

integrations
    → 08-integrations.md

decisions
    → 09-decisions.md

development standards
    → 10-development-standards.md

agent dna
    → 11-agent_dna.md

socials organization
    → 12-socials_organization.md
```

Do not create competing versions of the same truth in different locations.

When a foundational concept changes, update its source of truth.

---

# 06. Version Everything Important

Important Novara components should have versions.

This includes:

* agents
* capabilities
* APIs
* workflows
* prompts
* schemas
* policies
* architectural specifications
* major configuration

Changes should be traceable.

---

# 07. Backward Compatibility

Changes should avoid unnecessarily breaking existing systems.

When a breaking change is necessary:

1. identify the impact
2. document it
3. update dependent systems
4. test the migration
5. preserve historical information
6. verify the new system

---

# 08. Interfaces Before Implementations

Systems should communicate through clearly defined interfaces.

For example:

```text
agent
   ↓
capability interface
   ↓
provider adapter
   ↓
provider
```

Agents should not depend unnecessarily on provider-specific implementations.

This allows providers and implementations to change without destabilizing the organization.

---

# 09. Test Before Trust

No component should receive increased autonomy simply because it appears functional.

Testing should consider:

* expected behavior
* failure behavior
* edge cases
* invalid inputs
* permission boundaries
* resource limits
* security
* reliability
* recovery
* observability

Trust is earned through evidence.

---

# 10. Verification

Verification must happen at multiple levels.

### Unit verification

Does the individual component work?

### Integration verification

Do components work together?

### System verification

Does the complete workflow behave correctly?

### Human verification

Does the system actually produce the intended experience?

### Operational verification

Does it continue working reliably in the real environment?

---

# 11. No Fake Success

A test must never be considered successful simply because:

* a function returned without an error
* an API request was sent
* a UI component was generated
* a file was created
* a status changed to "complete"

Success means the intended result was actually observed.

Example:

```text
request:
render dashboard

not enough:
component generated

required:
dashboard actually renders and can be inspected
```

The distinction between:

> **attempted**

and:

> **successfully completed**

must remain explicit.

---

# 12. Observability

Important systems should expose enough information to understand their behavior.

Where appropriate, Novara should record:

* actions
* errors
* latency
* resource usage
* decisions
* inputs
* outputs
* agent identity
* capability identity
* provider identity
* authority
* results

Observability should support diagnosis without creating unnecessary noise.

---

# 13. Auditability

Important actions must be traceable.

The system should be able to determine:

> What happened?

> When?

> Which component acted?

> Why?

> With what authority?

> Using what information?

> What happened afterward?

This is especially important for autonomous actions.

---

# 14. Security by Design

Security is not added after functionality.

Every system should consider:

* authentication
* authorization
* secrets
* data access
* isolation
* logging
* permissions
* external actions
* provider access
* failure recovery

Agents should receive the minimum authority and access required for their mission.

---

# 15. Least Authority

Agents, capabilities and services should receive only the permissions required for their responsibilities.

An agent should not receive broad access simply because broad access is technically convenient.

Authority should be explicit.

Example:

```text
production agent

allowed:
create media
edit media
store media

not allowed:
modify financial accounts
create agents
change constitution
```

---

# 16. Reversibility

Where practical, actions should be reversible.

Prefer:

* versioned configuration
* backups
* rollback
* staged deployment
* reversible workflows
* approval gates for irreversible actions

The less reversible an action is, the stronger the required controls should be.

---

# 17. Failure Handling

Failures must be classified.

Examples:

* transient failure
* provider failure
* capability failure
* agent reasoning failure
* data failure
* permission failure
* infrastructure failure
* human decision dependency
* unknown failure

The system should avoid silently retrying indefinitely.

Repeated failures should escalate.

---

# 18. Graceful Degradation

When a component fails, Novara should continue operating where safely possible.

Example:

```text
provider A unavailable
        ↓
capability detects failure
        ↓
provider B available
        ↓
continue operation
```

If no safe alternative exists:

```text
stop
    ↓
explain
    ↓
escalate
```

The system should fail safely rather than fabricate success.

---

# 19. Human Approval

Human approval should be used where it provides meaningful risk reduction or strategic value.

Approval should not become bureaucracy.

The objective is:

> **Maximum useful autonomy within safe boundaries.**

As agents earn trust, unnecessary approval requirements should be reduced where appropriate.

---

# 20. Development Environment

Development should remain separated from production wherever practical.

Changes should move through controlled environments such as:

```text
development
    ↓
testing
    ↓
staging
    ↓
production
```

The exact environment structure may evolve with Novara's technical requirements.

---

# 21. Documentation

Important systems must be documented sufficiently for another capable person or agent to understand them.

Documentation should explain:

* purpose
* architecture
* interfaces
* dependencies
* permissions
* expected behavior
* failure behavior
* testing
* operational requirements

Documentation should describe reality, not intention.

---

# 22. AI-Generated Code

AI-generated code is treated as code.

It must be:

* reviewed
* tested
* understood sufficiently
* integrated correctly
* monitored

The fact that an AI produced code does not reduce the responsibility to verify it.

---

# 23. Dependency Discipline

Dependencies should be deliberate.

Before introducing a dependency, consider:

* necessity
* security
* maintenance
* licensing
* reliability
* provider lock-in
* performance
* alternatives

Avoid unnecessary dependencies that increase system complexity.

---

# 24. Provider Independence

External providers should be accessed through defined abstractions where practical.

A provider should be replaceable without requiring major changes to:

* agents
* business logic
* organizational architecture

Provider-specific behavior should remain isolated.

---

# 25. Data Quality

Data used for decisions should be treated as an important system dependency.

Novara should consider:

* source
* freshness
* accuracy
* completeness
* confidence
* provenance
* conflicts
* corruption

Agents should communicate uncertainty when data quality is insufficient.

---

# 26. Performance

Performance optimization should be evidence-based.

Do not optimize systems merely because something feels slow.

Measure:

* latency
* throughput
* resource usage
* cost
* reliability

Then optimize the actual bottleneck.

> **Measure before optimizing.**

---

# 27. Cost Awareness

Every scalable system must understand its resource consumption.

Where appropriate, Novara should track:

* compute
* API usage
* model usage
* storage
* bandwidth
* external services
* human attention

Low cost is not automatically good.

The objective is:

> **Value created relative to resources consumed.**

---

# 28. Change Management

Important changes should have:

* reason
* owner
* expected impact
* risk
* rollback plan where appropriate
* verification

Major architectural changes should be recorded in `09-decisions.md`.

---

# 29. Experiments

Novara should use controlled experimentation whenever uncertainty is high and experimentation is safe.

Experiments should define:

* hypothesis
* objective
* method
* resources
* duration
* measurement
* expected learning
* stopping conditions

A failed experiment is useful when it produces reliable learning.

---

# 30. Continuous Improvement

Development is never considered permanently finished.

Novara should continuously identify:

* bottlenecks
* unnecessary complexity
* reliability problems
* opportunities for automation
* opportunities for specialization
* outdated assumptions
* better providers
* better architectures

Improvements should be prioritized according to value and risk.

---

# 31. Development Quality

A high-quality implementation should be:

* correct
* understandable
* testable
* observable
* secure
* maintainable
* appropriately simple
* scalable where required

Complexity should be justified by value.

---

# 32. The Novara Development Loop

All meaningful development follows:

```text
understand
    ↓
define
    ↓
design
    ↓
build
    ↓
test
    ↓
verify
    ↓
observe
    ↓
learn
    ↓
improve
```

The loop repeats continuously.

---

# 33. Foundational Rule

Novara does not reward developers or agents for producing the appearance of progress.

It rewards **verified progress**.

> **If we say it works, it works.**

If it does not work:

> **Say so. Find out why. Find another route. Keep moving.**

---

# 34. Development Principle

> **Build boldly. Verify honestly. Fail visibly. Improve continuously.**
