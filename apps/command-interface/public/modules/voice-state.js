export const VOICE_MODES = Object.freeze({
  IDLE: "idle",
  LISTENING: "listening",
  THINKING: "thinking",
  SPEAKING: "speaking",
});

export function createVoiceState() {
  return {
    mode: VOICE_MODES.IDLE,
    audioLevel: 0,
    providerName: null,
    transcript: "",
  };
}

export function describeVoiceMode(mode) {
  switch (mode) {
    case VOICE_MODES.LISTENING:
      return "Listening";
    case VOICE_MODES.THINKING:
      return "Thinking";
    case VOICE_MODES.SPEAKING:
      return "Speaking";
    default:
      return "Idle";
  }
}
