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

export function createServerVoiceProvider({ onAudioLevel } = {}) {
  let activeAudio = null;
  let audioContext = null;
  let analyser = null;
  let sourceNode = null;
  let analysisFrame = null;
  let activeAudioUrl = null;
  let stopResolver = null;

  const emitAudioLevel = (level) => {
    if (typeof onAudioLevel === "function") {
      onAudioLevel(Math.max(0, Math.min(1, Number(level) || 0)));
    }
  };

  const stopAnalysisLoop = () => {
    if (analysisFrame != null) {
      cancelAnimationFrame(analysisFrame);
      analysisFrame = null;
    }
  };

  const teardownAudioGraph = async () => {
    stopAnalysisLoop();

    if (sourceNode) {
      try {
        sourceNode.disconnect();
      } catch {}
      sourceNode = null;
    }

    if (analyser) {
      try {
        analyser.disconnect();
      } catch {}
      analyser = null;
    }

    if (audioContext) {
      try {
        await audioContext.close();
      } catch {}
      audioContext = null;
    }
  };

  const releaseAudioUrl = () => {
    if (!activeAudioUrl) {
      return;
    }
    URL.revokeObjectURL(activeAudioUrl);
    activeAudioUrl = null;
  };

  const stopPlaybackPromise = () => {
    if (stopResolver) {
      const resolve = stopResolver;
      stopResolver = null;
      resolve();
    }
  };

  const stopAudio = async () => {
    stopPlaybackPromise();

    if (!activeAudio) {
      emitAudioLevel(0);
      await teardownAudioGraph();
      releaseAudioUrl();
      return;
    }

    const audio = activeAudio;
    activeAudio = null;

    audio.pause();
    audio.currentTime = 0;
    audio.src = "";

    emitAudioLevel(0);
    await teardownAudioGraph();
    releaseAudioUrl();
  };

  const startAudioAnalysis = async (audio) => {
    const ContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!ContextCtor) {
      return;
    }

    audioContext = new ContextCtor();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.65;

    sourceNode = audioContext.createMediaElementSource(audio);
    sourceNode.connect(analyser);
    analyser.connect(audioContext.destination);

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    const samples = new Uint8Array(analyser.fftSize);
    let smoothed = 0;

    const tick = () => {
      if (activeAudio !== audio || !analyser) {
        return;
      }

      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i += 1) {
        const centered = (samples[i] - 128) / 128;
        sum += centered * centered;
      }

      const rms = Math.sqrt(sum / samples.length);
      const normalized = Math.max(0, Math.min(1, rms * 3.6));
      const attack = normalized > smoothed ? 0.35 : 0.12;
      smoothed += (normalized - smoothed) * attack;

      emitAudioLevel(smoothed);
      analysisFrame = requestAnimationFrame(tick);
    };

    analysisFrame = requestAnimationFrame(tick);
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
      await stopAudio();

      const audio = new Audio(audioUrl);
      activeAudio = audio;
      activeAudioUrl = audioUrl;

      try {
        await startAudioAnalysis(audio);
        await audio.play();
        await new Promise((resolve, reject) => {
          stopResolver = resolve;
          audio.onended = () => resolve(undefined);
          audio.onerror = () => reject(new Error("Audio playback failed"));
        });
      } finally {
        stopResolver = null;
        emitAudioLevel(0);
        await teardownAudioGraph();
        releaseAudioUrl();
        if (activeAudio === audio) {
          activeAudio = null;
        }
      }
    },
    async stop() {
      await stopAudio();
    },
  };
}
