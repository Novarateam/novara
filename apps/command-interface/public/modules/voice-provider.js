import { VOICE_MODES, createVoiceState } from "./voice-state.js";

export function createVoiceController({ onChange } = {}) {
  let state = createVoiceState();

  const emit = () => {
    if (typeof onChange === "function") {
      onChange({ ...state });
    }
  };

  const setState = (patch) => {
    state = { ...state, ...patch };
    emit();
  };

  return {
    getState() {
      return { ...state };
    },
    attachProvider(provider) {
      setState({ providerName: provider?.name ?? null });
    },
    idle() {
      setState({ mode: VOICE_MODES.IDLE, audioLevel: 0 });
    },
    listening() {
      setState({ mode: VOICE_MODES.LISTENING, audioLevel: 0 });
    },
    thinking() {
      setState({ mode: VOICE_MODES.THINKING, audioLevel: 0 });
    },
    speaking(audioLevel = 1) {
      setState({ mode: VOICE_MODES.SPEAKING, audioLevel: Math.max(0, Math.min(1, audioLevel)) });
    },
    setTranscript(transcript) {
      setState({ transcript: String(transcript ?? "") });
    },
  };
}

export function createNoopVoiceProvider() {
  return {
    name: "noop",
    async startListening() {},
    async stopListening() {},
    async speak() {},
    async stop() {},
  };
}
