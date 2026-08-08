# Novara Decisions

## 01. Purpose

Decisions are a core organizational object within Novara.

Novara must be able to understand:

* what decision was made
* why it was made
* who or what made it
* what evidence was available
* what alternatives were considered
* what authority existed
* what happened afterward
* what was learned

A decision is not complete simply because an action was taken.

The result and learning must eventually return to the decision record.

---

# 02. Decision Principle

Novara separates:

**decision quality**

from:

**external outcome**

A good decision can produce a poor outcome because reality is uncertain.

A poor decision can occasionally produce a good outcome through luck.

Novara therefore evaluates decisions based on the information, reasoning and circumstances available **at the time the decision was made**.

---

# 03. Decision Lifecycle

Every meaningful decision follows a lifecycle:

```text id="r2x9h7"
signal
   ↓
problem / opportunity
   ↓
information
   ↓
options
   ↓
analysis
   ↓
recommendation
   ↓
authority check
   ↓
decision
   ↓
execution
   ↓
result
   ↓
evaluation
   ↓
learning
   ↓
memory
```

Not every decision requires every stage.

The process should scale according to importance and risk.

---

# 04. Decision Classes

Decisions are classified according to their impact.

## 04.01 Routine

Low-impact, reversible decisions within an agent's authority.

Examples:

* formatting
* scheduling
* minor workflow adjustments
* routine optimization

These should generally be autonomous.

---

## 04.02 Operational

Decisions that materially affect ongoing work but remain within defined boundaries.

Examples:

* changing an approved workflow
* reallocating resources
* changing content production priorities
* adjusting distribution strategy

These may be autonomous for sufficiently trusted agents.

---

## 04.03 Strategic

Decisions that materially affect Novara's direction.

Examples:

* changing a major strategy
* entering a new market
* changing a major business objective
* creating a significant new organizational function

Initially these require:

**human + AIOS involvement.**

---

## 04.04 Structural

Decisions that change the organization itself.

Examples:

* creating agents
* retiring agents
* splitting agents
* merging agents
* changing authority structures
* changing core workflows

Initially:

**human approval required.**

Eventually, limited structural authority may be earned.

---

## 04.05 Critical

Decisions involving significant:

* financial risk
* legal risk
* security risk
* reputational risk
* human impact
* irreversible consequences

These require appropriate human oversight regardless of agent performance.

---

# 05. Decision Record

Every meaningful decision should contain:

```text id="0x9zjt"
decision_id
title
status
date_created
decision_type

initiator
decision_maker

problem_or_opportunity

objective

context

evidence

confidence

options

recommendation

chosen_option

reasoning

authority

risk

reversibility

expected_result

execution_plan

review_date

actual_result

learning

memory_reference
```

Not every field must be populated for routine decisions.

---

# 06. Decision Status

Possible states:

* proposed
* under_review
* awaiting_approval
* approved
* rejected
* executing
* completed
* reversed
* superseded
* archived

---

# 07. Decision Authority

Before execution, Novara must determine whether the decision-maker has authority.

Example:

```text id="4y6j1n"
agent proposes decision
        ↓
authority check
        ↓
within authority?
   ┌────┴────┐
  yes        no
   ↓          ↓
execute    escalate
```

An agent must never interpret lack of authority as permission.

---

# 08. Human Decisions

During the initial Novara phase, Guido and the AIOS make the majority of strategic decisions together.

The system should make human decisions easy by presenting:

* decision
* recommendation
* evidence
* confidence
* alternatives
* risks
* expected impact
* reversibility
* required action

The human should not need to reconstruct the entire analysis manually.

---

# 09. AIOS Decision Support

The AIOS may:

* summarize decisions
* identify missing information
* compare options
* challenge assumptions
* recommend actions
* identify risks
* explain agent disagreements
* surface relevant historical decisions

The AIOS should not present recommendations as certainty when uncertainty exists.

---

# 10. Agent Decisions

Agents may make decisions independently when:

* the decision is within their authority
* constraints are satisfied
* required information is available
* risk is acceptable
* the decision is appropriate to their mission

Agents should escalate when:

* authority is unclear
* information is insufficient
* agents materially disagree
* risk exceeds authority
* the decision is outside mission
* the consequence is significant or irreversible

---

# 11. Decision Quality

Decision quality should be evaluated using the information available when the decision was made.

Relevant factors include:

* quality of evidence
* quality of reasoning
* identification of uncertainty
* consideration of alternatives
* risk awareness
* consistency with objectives
* appropriate use of resources
* authority compliance

The result is evaluated separately.

---

# 12. Confidence

Decisions should include confidence where meaningful.

Example:

```text id="2isq2j"
recommendation:
launch experiment

confidence:
78%

primary uncertainty:
audience response

reason:
evidence from 11 related experiments
```

Confidence is not a guarantee.

It is an explicit representation of uncertainty.

---

# 13. Reversibility

Decisions should identify whether they can be reversed.

### Reversible

Can easily be undone.

Example:

* change posting time

### Partially reversible

Can be corrected but may leave consequences.

Example:

* publish a poorly performing campaign

### Irreversible

Cannot realistically be undone.

Example:

* permanently deleting critical data

The less reversible a decision is, the stronger the required oversight should be.

---

# 14. Decision Conflicts

Agents are allowed and encouraged to disagree when they have legitimate reasons.

Example:

```text id="k9cz3q"
strategy:
recommend publishing

quality:
challenge — evidence insufficient

research:
supports strategy

audience:
confidence only 52%

conductor:
escalate
```

Disagreement should produce better decisions, not competition.

The objective is not to determine which agent "wins."

The objective is to determine what is most likely to be correct.

---

# 15. Decision Execution

Once approved, the decision becomes an executable objective.

The Conductor may:

* assign work
* select agents
* allocate resources
* track execution
* monitor progress
* escalate problems

Execution should remain linked to the original decision.

---

# 16. Decision Review

Important decisions should have a review point.

At review, Novara asks:

> What happened?

> Was the original reasoning correct?

> What changed?

> What was unexpected?

> Was the execution good?

> Should we continue, change or reverse the decision?

---

# 17. Learning From Decisions

The result of a decision should feed back into Novara's learning system.

Example:

```text id="9p7r2b"
decision:
publish short-form educational content

hypothesis:
audience retention will increase

result:
retention increased 14%

learning:
strong evidence supporting educational format

action:
increase future experimentation in this format
```

The decision becomes part of organizational memory.

---

# 18. Decision History

Novara should maintain a searchable history of meaningful decisions.

The AIOS should eventually be able to answer:

> "Why did we decide this?"

with the original decision record.

It should also be able to answer:

> "Have we made a similar decision before?"

and:

> "What happened last time?"

---

# 19. Decision Quality Over Outcome

Novara must never judge a decision solely by whether it succeeded.

Example:

An agent makes a decision with:

* strong evidence
* appropriate reasoning
* explicit uncertainty
* good alternatives
* correct authority
* excellent execution

but the external environment unexpectedly changes.

The outcome is poor.

The decision may still have been excellent.

Conversely, an agent may make a poorly reasoned decision that happens to succeed.

The outcome does not make the reasoning good.

---

# 20. Decision Transparency

Important decisions must be traceable.

Novara should be able to reconstruct:

```text id="4t0z8d"
What happened?
      ↓
What was known?
      ↓
What options existed?
      ↓
Why was this chosen?
      ↓
Who had authority?
      ↓
What happened?
      ↓
What did we learn?
```

---

# 21. Decision Principle

> **Make the best decision possible with the information available, execute it well, measure reality honestly, and learn from what happens.**

Novara does not require certainty.

It requires disciplined decision-making under uncertainty.

---

# 22. Foundational Rule

No decision should become unquestionable simply because it was made by:

* a human
* the AIOS
* the Conductor
* a high-performing agent
* a trusted agent

New evidence can challenge previous decisions.

Novara is allowed to change its mind.

> **Consistency is valuable. Being consistently wrong is not.**
