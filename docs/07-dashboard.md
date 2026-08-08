# Novara Dashboard

## 01. Purpose

The Novara Dashboard is the visual command center for the organization.

Its primary purpose is to allow a human to understand the state of Novara at a glance without needing to inspect individual agents, systems or data sources.

The dashboard should answer:

> **How is Novara doing?**

> **What changed?**

> **What needs attention?**

> **What decisions require me?**

> **Where is the organization improving or deteriorating?**

> **What is Novara learning?**

The dashboard is an observability and decision-support system.

It is not the AIOS.

The AIOS is the conversational operating interface.

---

# 02. Design Principle

The dashboard should present the complete organizational state on one primary screen.

Detailed information should be available through drill-downs rather than separate dashboards wherever practical.

The user should not need to navigate through multiple screens simply to understand whether Novara is healthy.

> **One screen for understanding. Drill down for investigation.**

---

# 03. Primary Screen

The primary dashboard contains six areas:

```text
┌──────────────────────────────────────────────────────────────┐
│                       NOVARA STATE                           │
│                                                              │
│  System Health    Performance    Trajectory    Autonomy      │
│       94              91             ↑            68%         │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                    ATTENTION REQUIRED                        │
│                                                              │
│  Critical issues │ Warnings │ Opportunities │ Decisions      │
│                                                              │
├───────────────────────────────┬──────────────────────────────┤
│                               │                              │
│      BUSINESS / OUTCOMES      │      AGENT ORGANIZATION      │
│                               │                              │
│      Audience                │      Agents                  │
│      Content                 │      Performance              │
│      Revenue                │      Trajectory                │
│      Experiments            │      Capacity                  │
│                               │      Authority                │
├───────────────────────────────┴──────────────────────────────┤
│                                                              │
│                 DECISIONS + INTELLIGENCE                     │
│                                                              │
│  Decisions │ Learning │ Recommendations │ Signals             │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

The exact visual design may change.

The information architecture should remain stable.

---

# 04. System State

The top of the dashboard shows the overall state of Novara.

Initial indicators:

* system health
* current performance
* trajectory
* active agents
* active tasks
* autonomous work
* human decisions required
* critical issues

These are summary indicators, not the complete performance model.

---

# 05. System Health

System Health represents the current operational health of Novara.

It should consider relevant dimensions such as:

* agent health
* capability health
* infrastructure health
* workload
* errors
* unresolved issues
* governance concerns
* performance trajectory

The score must never hide important problems.

For example:

```text
system health: 94

warning:
production capacity: 94%

warning:
research trajectory: declining

critical issues: 0
```

A high overall score must not obscure a critical issue.

---

# 06. Current Performance

Current Performance represents how effectively Novara is operating at the present time.

It should be calculated from relevant performance dimensions rather than a single KPI.

The dashboard should allow drill-down into:

* execution
* decision quality
* detection
* adaptation
* learning
* integrity
* collaboration
* efficiency
* impact

---

# 07. Trajectory

Trajectory shows whether Novara is improving, stable or declining.

Examples:

* improving ↑
* stable →
* declining ↓
* significantly off roadmap ⚠

Trajectory should be visible alongside current performance.

A high current score with a declining trajectory should be treated as a warning.

---

# 08. Attention Required

This is one of the most important dashboard areas.

It should surface only issues that require meaningful attention.

Examples:

### Critical

* governance violation
* security issue
* major system failure
* severe quality problem

### Warning

* agent capacity approaching limit
* declining performance
* recurring failure
* unusual resource consumption
* capability degradation

### Opportunity

* significant emerging opportunity
* strong experiment result
* useful organizational insight
* potential structural improvement

The dashboard should avoid creating unnecessary alert noise.

---

# 09. Business State

The business section shows the current external reality.

During the initial Socials phase, this includes:

### Audience

* audience growth
* audience quality
* engagement
* retention
* returning audience
* audience trajectory

### Content

* content produced
* content performance
* experiments
* winning patterns
* declining patterns

### Revenue

* revenue
* revenue growth
* conversion
* revenue per audience member
* revenue trajectory

### Experiments

* active experiments
* completed experiments
* successful experiments
* failed experiments
* experiments requiring decisions

These metrics will evolve as Novara enters additional markets.

---

# 10. Agent Organization

The dashboard shows the current state of the agent organization.

For every active agent, show at minimum:

* agent name
* mission
* current performance
* trajectory
* authority level
* capacity
* current status
* active workload

Example:

```text
opportunity     92   ↑   L3   61%   healthy
research        88   ↑   L3   73%   healthy
audience        91   →   L2   54%   healthy
strategy        94   ↑   L3   48%   healthy
creative        94   →   L4   81%   healthy
production      86   ↓   L3   94%   warning
quality         97   ↑   L4   42%   healthy
distribution    91   →   L3   66%   healthy
performance     96   ↑   L4   54%   healthy
learning        93   ↑   L3   37%   healthy
```

The actual values will come from the performance system.

---

# 11. Capacity

Capacity is a first-class organizational metric.

The dashboard should identify:

* overloaded agents
* underutilized agents
* growing queues
* bottlenecks
* increasing workload
* declining performance caused by capacity

The system should distinguish:

> **Agent performance problem**

from:

> **Organizational capacity problem**

When capacity is the problem, Novara should consider redistribution or additional specialization.

---

# 12. Autonomy

The dashboard should show how much of Novara is operating autonomously.

It should include:

* percentage of autonomous work
* authority distribution
* agents awaiting promotion
* agents under review
* recent authority changes
* authority exceptions

Example:

```text
autonomous work       68%
approval required     24%
human-directed         8%

agents:
2 candidates for increased authority
1 agent under review
0 critical authority violations
```

Autonomy is earned and should never be presented purely as a growth metric.

More autonomy is only better when trust and performance justify it.

---

# 13. Decisions

The dashboard must make human decisions highly visible.

Examples:

```text
03 decisions require attention

01
Create additional production specialist

02
Approve new content experiment

03
Review strategy change proposed by strategy agent
```

Every decision should show:

* what is being decided
* why
* recommendation
* evidence
* confidence
* impact
* required authority
* reversibility
* deadline where relevant

---

# 14. Intelligence

The dashboard should surface useful organizational intelligence.

Examples:

### Signal

An emerging opportunity has been detected.

### Learning

A hypothesis has gained strong supporting evidence.

### Challenge

Two agents disagree about a strategic assumption.

### Recommendation

The Conductor recommends changing organizational structure.

### Pattern

Multiple experiments indicate the same audience behavior.

This section should prioritize meaningful intelligence over volume.

---

# 15. Learning

The dashboard should show what Novara has learned recently.

Examples:

```text
NEW LEARNING

Audience responds significantly better to X format.

Confidence: 91%
Evidence: 18 experiments
Last validated: today
```

Learning should include:

* insight
* evidence
* confidence
* source
* date
* status
* recommended action

---

# 16. Organizational Map

The dashboard should provide an optional visual view of the organization.

Example:

```text
human + aios
      │
  conductor
      │
 ┌────┼───────────────────────────┐
 │    │       │       │           │
opp research audience strategy  quality
 │              │       │
creative ─── production ─── distribution
                  │
             performance
                  │
               learning
```

This is an exploration layer.

It should not replace the primary one-screen overview.

---

# 17. Drill Down

Every major dashboard object should be inspectable.

Examples:

```text
system health
    ↓
health dimensions
    ↓
problem area
    ↓
agent / capability
    ↓
specific event
    ↓
evidence
```

Or:

```text
agent
    ↓
performance
    ↓
score history
    ↓
tasks
    ↓
decisions
    ↓
actions
    ↓
results
```

The dashboard should allow investigation without losing organizational context.

---

# 18. Historical State

The dashboard should allow comparison over time.

Important views include:

* today
* last 7 days
* last 30 days
* previous period
* roadmap
* historical trend

Current state should always be interpreted alongside trajectory.

---

# 19. Auditability

Important dashboard data must link back to underlying evidence.

A user should be able to move from:

> **Score: 86**

to:

> Why?

to:

> Performance dimensions

to:

> Specific events

to:

> Actions

to:

> Evidence.

The dashboard must not become a black box.

---

# 20. AIOS Relationship

The dashboard and AIOS use the same underlying organizational state.

The dashboard provides visual observability.

The AIOS provides conversational interaction.

Example:

Dashboard:

> Production capacity: 94%

User asks AIOS:

> "Why?"

AIOS should retrieve the same organizational state and explain the cause.

The dashboard and AIOS must not develop contradictory versions of reality.

---

# 21. Future Scale

The dashboard architecture must support Novara growing beyond Socials.

Future organizational areas may include:

* commerce
* marketing
* software
* finance
* customer operations
* sales
* research
* new businesses
* new markets

The primary screen should remain understandable even as organizational complexity increases.

Complexity should be handled through:

* summarization
* grouping
* filtering
* drill-down
* prioritization

Not by endlessly adding dashboard screens.

---

# 22. Dashboard Principle

The dashboard should never attempt to show everything.

It should show **what matters**.

The system should determine what deserves attention based on:

* importance
* urgency
* risk
* trajectory
* opportunity
* impact
* confidence

> **The dashboard is not a database. It is a window into organizational state.**

---

# 23. Foundational Goal

When Guido opens Novara, the first screen should allow him to understand the organization in seconds.

He should be able to answer:

> **Are we healthy?**

> **Are we improving?**

> **What is going wrong?**

> **What is going well?**

> **What has Novara discovered?**

> **What decisions need me?**

> **Where is capacity becoming a problem?**

> **How much autonomy has been earned?**

> **What does Novara recommend we do next?**

If those questions can be answered without navigating through the organization, the dashboard is doing its job.
