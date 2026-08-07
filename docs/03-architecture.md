# Novara Architecture

## Architectural Layers

Novara is built in independent layers.

Each layer has a single responsibility.

```
Company
    │
Platform
    │
Applications
    │
Agents
    │
Capabilities
    │
Providers
    │
Infrastructure
```

Each layer depends only on the layer below it.

No provider should be directly referenced by business logic.

Providers are replaceable.

Capabilities remain stable.

This architecture allows Novara to evolve without rewriting the entire system.
