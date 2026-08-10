# Novara Checkpoint

DATE:
2026-08-10

CURRENT:
- durable Agent Runtime
- Hermes task orchestration
- generic agent communication
- scoped runtime memory
- task/agent/department/company/Novara memory scopes
- persisted memory-scope bindings
- audit trail
- Obsidian remains read-only reference memory

COMPLETED:
- Hermes-first Command Interface implemented
- Real Hermes reasoning through /api/hermes/ask
- Real ElevenLabs voice through /api/voice/speak
- Typed user interaction
- Hermes THINKING state
- Hermes SPEAKING state
- Hermes IDLE state
- Sphere speaking animation
- Audio playback completion handling
- Input re-enabled after playback
- API key remains server-side
- No fabricated company metrics
- Monthly goals remain No data when not configured
- Microphone/STT is NOT implemented yet

CURRENT VOICE STATE:
Voice is connected through the existing provider abstraction to backend ElevenLabs synthesis.
The active flow is: typed message -> Hermes reasoning -> voice playback -> idle.

NEXT:
1. Finance/Accountant capability
2. permission/risk controls
3. departments and specialist agents
4. broader memory/learning later

IMPORTANT DESIGN DECISIONS:
- The Hermes Command Interface prototype is the visual source of truth.
- The home screen is NOT a traditional dashboard.
- Hermes is the dominant visual element.
- Large negative space is intentional.
- The old circular organization visualization belongs to a future Organization/Agents view, not the home screen.
- Do not fill the home screen with additional cards or analytics.
- Voice should be represented primarily through Hermes itself.
- ElevenLabs must remain replaceable/modular.
- Do not expose API keys in frontend code.
- Novara must never fabricate business metrics.
- If real data is unavailable, show "No data" or "Not connected" instead of invented values.
- Do not add microphone/STT until the hardware phase.

IMPORTANT:
Record the exact files changed in this session and any relevant architectural notes.

FILES CHANGED IN THIS SESSION:
- [apps/command-interface/public/app.js](../apps/command-interface/public/app.js)
- [apps/command-interface/public/modules/voice-provider.js](../apps/command-interface/public/modules/voice-provider.js)
- [apps/command-interface/src/server.ts](../apps/command-interface/src/server.ts)
- [.gitignore](../.gitignore)
- [docs/CHECKPOINT.md](./CHECKPOINT.md)

ARCHITECTURAL NOTES:
- The command interface stays on the existing Novara backend/data layer.
- Voice remains provider-agnostic through the current abstraction seam.
- ElevenLabs API key usage is server-side only in the voice route.
- Typed Hermes interactions now drive the voice lifecycle (THINKING -> SPEAKING -> IDLE).
- The live UI displays runtime values only and uses explicit no-data states when runtime values are missing.