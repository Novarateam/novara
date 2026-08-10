# Novara Checkpoint

DATE:
2026-08-10

CURRENT STATE:
The Hermes-first Command Interface is implemented and stable. The home screen now uses the organic central Hermes network sphere, the old circular organization UI has been removed, and the interface follows the real-data-only rule for all displayed operational values.

COMPLETED:
- Hermes-first Command Interface implemented
- Central organic network sphere implemented
- Company Pulse implemented with real-data-only behavior
- No-data states used where runtime data is unavailable
- Attention / Currently / Next use runtime state
- Active Agents use actual registered agents
- Old circular organization UI removed from home
- Voice abstraction remains ready for future ElevenLabs integration
- ElevenLabs is NOT connected yet
- Detailed dashboards are NOT built yet
- Organization / Agents view remains a future phase

CURRENT VOICE STATE:
Voice interaction is NOT yet connected to ElevenLabs.
The provider abstraction exists and should remain modular.

NEXT SESSION:
1. Connect ElevenLabs.
2. Connect microphone input.
3. Implement listening state.
4. Implement thinking state.
5. Implement speaking state.
6. Make the central sphere react to Hermes' actual voice/audio.
7. Then begin building the deeper Novara memory/Obsidian architecture.
8. Dashboards later.

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

IMPORTANT:
Record the exact files changed in this session and any relevant architectural notes.

FILES CHANGED IN THIS SESSION:
- [apps/command-interface/public/app.js](../apps/command-interface/public/app.js)
- [apps/command-interface/src/server.ts](../apps/command-interface/src/server.ts)
- [docs/CHECKPOINT.md](./CHECKPOINT.md)

ARCHITECTURAL NOTES:
- The command interface stays on the existing Novara backend/data layer.
- Voice remains provider-agnostic through the current abstraction seam.
- The old organization view concepts are reserved for a future dedicated view, not the home screen.
- The live UI now displays runtime values only and uses explicit no-data states when the runtime does not provide a value.