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

export function createServerVoiceProvider() {
  let activeAudio = null;

  const stopAudio = () => {
    if (!activeAudio) {
      return;
    }
    activeAudio.pause();
    activeAudio.currentTime = 0;
    activeAudio.src = "";
    activeAudio = null;
  };

  return {
    name: "server-elevenlabs",
    async startListening() {},
    async stopListening() {},
    async speak(text) {
      const line = String(text ?? "").trim();
      if (!line) {
        return;
      }

      const response = await fetch("/api/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: line }),
      });

      if (!response.ok) {
        throw new Error("Voice synthesis unavailable");
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      stopAudio();

      const audio = new Audio(audioUrl);
      activeAudio = audio;

      try {
        await audio.play();
        await new Promise((resolve, reject) => {
          audio.onended = () => resolve(undefined);
          audio.onerror = () => reject(new Error("Audio playback failed"));
        });
      } finally {
        URL.revokeObjectURL(audioUrl);
        if (activeAudio === audio) {
          activeAudio = null;
        }
      }
    },
    async stop() {
      stopAudio();
    },
  };
}
