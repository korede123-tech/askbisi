const API_BASE = window.location.origin;

// === UI ELEMENTS ===
const startBtn = document.getElementById("startBtn");
const status = document.getElementById("status");
const micWrapper = startBtn.closest(".mic-wrapper");

let keepListening = false;
let audioCtx;
let levelFrame;
let stopActiveRecording;
let cancelActiveAudio;

const SPEECH_START_TIMEOUT_MS = 8000;
const MAX_RECORDING_MS = 25000;
const MAX_PLAYBACK_LISTEN_MS = 30000;
const END_OF_SPEECH_SILENCE_MS = 1200;
const MIN_SPEECH_MS = 100;

// === UNLOCK AUDIO CONTEXT (iOS & Android SAFE) ===
document.addEventListener("touchstart", unlockAudioContext, { once: true });
document.addEventListener("click", unlockAudioContext, { once: true });

// === START / STOP LOGIC ===
startBtn.addEventListener("click", async () => {
  if (keepListening) {
    keepListening = false;
    startBtn.setAttribute("aria-pressed", "false");
    startBtn.setAttribute("aria-label", "Ask Bisi");
    status.innerText = "🛑 Stopped listening.";
    stopActiveRecording?.();
    cancelActiveAudio?.();
    return;
  }

  keepListening = true;
  startBtn.setAttribute("aria-pressed", "true");
  startBtn.setAttribute("aria-label", "Stop listening");
  await unlockAudioContext();
  let pendingRecording;

  while (keepListening) {
    try {
      status.innerText = pendingRecording ? "🎤 Listening to your interruption..." : "🎤 Listening... speak now";
      const recording = pendingRecording || await recordAudio();
      pendingRecording = undefined;
      if (!keepListening) break;
      if (!recording.heardSpeech) {
        status.innerText = "I didn't catch clear speech. Try again.";
        continue;
      }
      console.log("🎧 Recorded audioBlob:", recording.blob);

      status.innerText = "Processing your speech...";
      const userText = await transcribeAudio(recording.blob);
      if (!userText || !keepListening) continue;

      if (/^\[[^\]]+\]$/.test(userText.trim())) {
        status.innerText = "I heard background noise, not clear words. Try again.";
        continue;
      }

      status.innerText = `You said: "${userText}"`;

      const reply = await getChatResponse(userText);
      if (!keepListening) continue;

      status.innerText = `Bisi says: "${reply}"`;

      const voiceBlob = await textToSpeech(reply);
      if (voiceBlob && keepListening) {
        pendingRecording = await playAudioAwaitable(voiceBlob);
      }
    } catch (err) {
      console.error("🚨 Unexpected error:", err);
      status.innerText = "❌ Something went wrong (see console).";
      keepListening = false;
    }
  }

  startBtn.setAttribute("aria-pressed", "false");
  startBtn.setAttribute("aria-label", "Ask Bisi");
  stopVoiceGlow();
});

// === RECORD AUDIO ===
async function recordAudio({ onReady, onSpeechStart, waitForSpeechMs = SPEECH_START_TIMEOUT_MS } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.75;
  const microphone = audioCtx.createMediaStreamSource(stream);
  microphone.connect(analyser);
  startVoiceGlow(analyser);

  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : MediaRecorder.isTypeSupported("audio/mp4")
    ? "audio/mp4"
    : "";

  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
  const chunks = [];

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const noiseSamples = [];
    let speechStartedAt = 0;
    let lastVoiceAt = 0;
    let aboveThresholdAt = 0;
    let voiceThreshold = 0.015;
    let readyNotified = false;
    let speechStartNotified = false;
    let voiceCheck;

    const stopRecording = () => {
      if (voiceCheck) clearInterval(voiceCheck);
      voiceCheck = undefined;
      if (recorder.state !== "inactive") recorder.stop();
    };

    stopActiveRecording = stopRecording;
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
      if (voiceCheck) clearInterval(voiceCheck);
      stopActiveRecording = undefined;
      stopVoiceGlow();
      microphone.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      resolve({ blob, heardSpeech: Boolean(speechStartedAt) });
    };
    recorder.onerror = (event) => {
      if (voiceCheck) clearInterval(voiceCheck);
      stopActiveRecording = undefined;
      stopVoiceGlow();
      microphone.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      reject(event.error || new Error("Audio recording failed."));
    };

    recorder.start(250);
    const samples = new Uint8Array(analyser.fftSize);
    voiceCheck = setInterval(() => {
      const now = Date.now();
      const elapsed = now - startedAt;
      analyser.getByteTimeDomainData(samples);
      let sumOfSquares = 0;

      for (const sample of samples) {
        const amplitude = (sample - 128) / 128;
        sumOfSquares += amplitude * amplitude;
      }

      const volume = Math.sqrt(sumOfSquares / samples.length);
      if (elapsed < 350) {
        noiseSamples.push(volume);
        if (noiseSamples.length === 5) {
          noiseSamples.sort((a, b) => a - b);
          voiceThreshold = Math.max(0.012, Math.min(0.035, noiseSamples[1] * 2.5));
        }
      } else {
        if (!readyNotified) {
          readyNotified = true;
          onReady?.();
        }

        if (volume >= voiceThreshold) {
          if (!aboveThresholdAt) aboveThresholdAt = now;
          if (!speechStartedAt && now - aboveThresholdAt >= MIN_SPEECH_MS) {
            speechStartedAt = aboveThresholdAt;
          }
          if (speechStartedAt) {
            lastVoiceAt = now;
            if (!speechStartNotified) {
              speechStartNotified = true;
              onSpeechStart?.();
            }
          }
        } else {
          aboveThresholdAt = 0;
        }
      }

      if (
        (speechStartedAt && now - lastVoiceAt >= END_OF_SPEECH_SILENCE_MS) ||
        (!speechStartedAt && elapsed >= waitForSpeechMs) ||
        elapsed >= MAX_RECORDING_MS
      ) {
        stopRecording();
      }
    }, 50);
  });
}

function startVoiceGlow(analyser) {
  const samples = new Uint8Array(analyser.fftSize);
  micWrapper.classList.add("is-listening");

  const updateGlow = () => {
    analyser.getByteTimeDomainData(samples);
    let sumOfSquares = 0;

    for (const sample of samples) {
      const amplitude = (sample - 128) / 128;
      sumOfSquares += amplitude * amplitude;
    }

    const volume = Math.sqrt(sumOfSquares / samples.length);
    const voiceLevel = Math.min(1, Math.max(0, (volume - 0.015) * 7));
    micWrapper.style.setProperty("--voice-glow-opacity", `${0.12 + voiceLevel * 0.88}`);
    micWrapper.style.setProperty("--voice-glow-scale", `${1.02 + voiceLevel * 0.42}`);
    micWrapper.style.setProperty("--voice-core-scale", `${1 + voiceLevel * 0.16}`);
    levelFrame = requestAnimationFrame(updateGlow);
  };

  updateGlow();
}

function stopVoiceGlow() {
  if (levelFrame) cancelAnimationFrame(levelFrame);
  levelFrame = undefined;
  micWrapper.classList.remove("is-listening");
  micWrapper.style.setProperty("--voice-glow-opacity", "0.2");
  micWrapper.style.setProperty("--voice-glow-scale", "1");
  micWrapper.style.setProperty("--voice-core-scale", "1");
}

// === SPEECH-TO-TEXT ===
async function transcribeAudio(audioBlob) {
  try {
    const formData = new FormData();
    const extension = audioBlob.type.includes("mp4")
      ? "mp4"
      : audioBlob.type.includes("webm")
      ? "webm"
      : "audio";
    formData.append("file", audioBlob, `speech.${extension}`);

    const response = await fetch(`${API_BASE}/api/transcribe`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("🛑 Transcription failed:", errText);
      return null;
    }

    const result = await response.json();
    console.log("📜 Transcription:", result);
    return result.text || "";
  } catch (err) {
    console.error("Transcription error:", err);
    return null;
  }
}

// === OPENAI CHAT ===
async function getChatResponse(prompt) {
  try {
    const response = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Chat API error:", data);
      return "Chat service failed.";
    }

    const reply = data.reply || "Sorry, I didn’t catch that.";
    console.log("🧠 Bisi's Reply:", reply);
    return reply;
  } catch (err) {
    console.error("Chat error:", err);
    return "Something went wrong.";
  }
}

// === ELEVENLABS TTS ===
async function textToSpeech(text) {
  try {
    const response = await fetch(`${API_BASE}/api/tts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const message = errorData.error || "Text-to-speech request failed.";
      console.error("🛑 TTS failed:", message, errorData.code || "");
      status.innerText = message;
      return null;
    }

    return await response.blob();
  } catch (err) {
    console.error("TTS error:", err);
    return null;
  }
}

// === PLAY AUDIO ===
async function playAudioAwaitable(blob) {
  await unlockAudioContext();
  const audioUrl = URL.createObjectURL(blob);
  const audio = new Audio(audioUrl);
  let finishAudio;
  const audioFinished = new Promise((resolve) => {
    finishAudio = resolve;
  });

  audio.onended = () => finishAudio("ended");
  audio.onerror = () => finishAudio("error");
  const recordingPromise = recordAudio({
    waitForSpeechMs: MAX_PLAYBACK_LISTEN_MS,
    onReady: () => {
      if (keepListening) {
        audio.play().catch((error) => {
          console.warn("Playback error:", error);
          finishAudio("error");
        });
      } else {
        finishAudio("cancelled");
      }
    },
    onSpeechStart: () => {
      status.innerText = "I hear you—go ahead.";
      audio.pause();
    },
  });

  cancelActiveAudio = () => {
    audio.pause();
    finishAudio("cancelled");
    stopActiveRecording?.();
  };

  try {
    const outcome = await Promise.race([
      recordingPromise.then((recording) => ({ type: "recording", recording })),
      audioFinished.then((type) => ({ type })),
    ]);

    if (outcome.type !== "recording") {
      stopActiveRecording?.();
      await recordingPromise;
      return null;
    }

    return outcome.recording.heardSpeech ? outcome.recording : null;
  } finally {
    cancelActiveAudio = undefined;
    audio.pause();
    audio.onended = null;
    audio.onerror = null;
    URL.revokeObjectURL(audioUrl);
  }
}

// === UNLOCK CONTEXT ===
async function unlockAudioContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") await audioCtx.resume();
}
