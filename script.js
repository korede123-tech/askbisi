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
let audioContextPrimed = false;

const SPEECH_START_TIMEOUT_MS = 8000;
const MAX_RECORDING_MS = 60000;
const MAX_PLAYBACK_LISTEN_MS = 30000;
const END_OF_SPEECH_SILENCE_MS = 600;
const MIN_SPEECH_MS = 100;
const CHROME_AUDIO_ROUTE = /(?:Chrome|CriOS|Chromium)\//.test(navigator.userAgent)
  && !/(?:Edg|OPR)\//.test(navigator.userAgent);

// === START / STOP LOGIC ===
startBtn.addEventListener("click", async () => {
  micWrapper.classList.remove("tap-effect");
  void startBtn.offsetWidth;
  micWrapper.classList.add("tap-effect");
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
  try {
    await unlockAudioContext();
  } catch (err) {
    console.error("Audio initialization failed:", err);
    keepListening = false;
    startBtn.setAttribute("aria-pressed", "false");
    startBtn.setAttribute("aria-label", "Ask Bisi");
    const detail = err instanceof Error ? err.message : "Check your browser's audio settings and try again.";
    status.innerText = `Audio couldn't start: ${detail}`;
    return;
  }
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
      let userText;
      try {
        userText = await transcribeAudio(recording.blob);
      } catch (error) {
        console.error("Speech transcription failed:", error);
        status.innerText = `Could not understand the recording: ${error.message}`;
        continue;
      }
      if (!userText || !keepListening) continue;

      if (/^\[[^\]]+\]$/.test(userText.trim())) {
        status.innerText = "I heard background noise, not clear words. Try again.";
        continue;
      }

      status.innerText = `You said: "${userText}"`;

      status.innerText = "Bisi is thinking…";
      const reply = await getChatResponse(userText);
      if (!keepListening) continue;

      status.innerText = `Bisi says: "${reply}"`;

      let voiceBlob;
      try {
        voiceBlob = await textToSpeech(reply);
      } catch (error) {
        console.error("Speech synthesis failed:", error);
        status.innerText = `I heard you, but couldn't create a voice reply: ${error.message}`;
        keepListening = false;
        break;
      }
      if (voiceBlob && keepListening) {
        status.innerText = "Speaking…";
        pendingRecording = await playAudioAwaitable(voiceBlob);
      }
    } catch (err) {
      console.error("🚨 Unexpected error:", err);
      status.innerText = getMicrophoneErrorMessage(err);
      keepListening = false;
    }
  }

  startBtn.setAttribute("aria-pressed", "false");
  startBtn.setAttribute("aria-label", "Ask Bisi");
  stopVoiceGlow();
});

// === RECORD AUDIO ===
async function recordAudio({
  onReady,
  onSpeechStart,
  waitForSpeechMs = SPEECH_START_TIMEOUT_MS,
  existingStream,
  speechAlreadyStarted = false,
} = {}) {
  if (!window.isSecureContext) {
    throw new Error("Microphone access requires HTTPS. Open Ask Bisi using its secure website address.");
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    throw new Error("This browser cannot record audio. Please use the latest version of Safari.");
  }

  const stream = existingStream || await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  let analyser;
  let microphone;
  let recorder;
  try {
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.75;
    microphone = audioCtx.createMediaStreamSource(stream);
    microphone.connect(analyser);
    startVoiceGlow(analyser);

    const mimeType = [
      "audio/mp4;codecs=mp4a.40.2",
      "audio/mp4",
      "audio/webm;codecs=opus",
      "audio/webm",
    ].find((type) => MediaRecorder.isTypeSupported?.(type));
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    microphone?.disconnect();
    stopVoiceGlow();
    throw error;
  }
  const chunks = [];

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const noiseSamples = [];
    let speechStartedAt = speechAlreadyStarted ? startedAt : 0;
    let lastVoiceAt = speechAlreadyStarted ? startedAt : 0;
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
      const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || "application/octet-stream" });
      if (voiceCheck) clearInterval(voiceCheck);
      stopActiveRecording = undefined;
      stopVoiceGlow();
      microphone.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      if (!blob.size) {
        reject(new Error("Your browser recorded an empty audio clip. Update Safari and try again."));
        return;
      }
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

    try {
      recorder.start(250);
    } catch (error) {
      if (voiceCheck) clearInterval(voiceCheck);
      stopActiveRecording = undefined;
      stopVoiceGlow();
      microphone.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      reject(error);
      return;
    }
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
      if (!speechStartedAt && elapsed < 350) {
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

function getMicrophoneErrorMessage(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return "Microphone blocked. Allow microphone access for Ask Bisi in Safari settings, then try again.";
  }
  if (error?.name === "NotFoundError") {
    return "No microphone was found. Check your device’s audio input and try again.";
  }
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
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
      const errorData = await response.json().catch(() => ({}));
      const detail = errorData.error || errorData.detail || "Speech transcription failed.";
      const message = typeof detail === "string" ? detail : detail.message || "Speech transcription failed.";
      throw new Error(message);
    }

    const result = await response.json();
    console.log("📜 Transcription:", result);
    return result.text || "";
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error("Could not reach speech transcription. Check your internet connection and try again.");
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
      throw new Error(message);
    }

    if (!response.body) throw new Error("The speech service returned no audio stream.");
    return response;
  } catch (err) {
    console.error("TTS error:", err);
    throw err instanceof Error
      ? err
      : new Error("Could not reach the speech service. Check your internet connection and try again.");
  }
}

// === PLAY AUDIO ===
async function playAudioAwaitable(response) {
  await unlockAudioContext();
  let source;
  let audioElement;
  let mediaSource;
  let streamReader;
  let playbackStarted = false;
  let playbackRequested = false;
  let playbackPending = false;
  let playbackCancelled = false;
  let startPlayback;
  let resolveAudioFinished;
  const audioFinished = new Promise((resolve) => {
    resolveAudioFinished = resolve;
  });

  const stopPlayback = () => {
    playbackStarted = false;
    if (source) {
      const activeSource = source;
      source = undefined;
      activeSource.onended = null;
      activeSource.stop();
      activeSource.disconnect();
    }
    if (audioElement) {
      playbackCancelled = true;
      playbackPending = false;
      audioElement.pause();
      void streamReader?.cancel();
    }
  };

  const startBufferedPlayback = async (audioBuffer) => {
    if (source || !keepListening) return;
    if (audioCtx.state !== "running") await audioCtx.resume();
    if (audioCtx.state !== "running") {
      throw new Error("Audio is paused. Tap Ask Bisi to enable audio, then try again.");
    }
    source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);
    source.onended = () => {
      const endedSource = source;
      source = undefined;
      endedSource?.disconnect();
      playbackStarted = false;
      resolveAudioFinished("ended");
    };
    source.start();
    playbackStarted = true;
  };

  const canStreamMp3 = CHROME_AUDIO_ROUTE
    && typeof MediaSource !== "undefined"
    && MediaSource.isTypeSupported("audio/mpeg")
    && !/(?:iPhone|iPad|iPod)/i.test(navigator.userAgent);

  if (canStreamMp3) {
    mediaSource = new MediaSource();
    audioElement = new Audio();
    const objectUrl = URL.createObjectURL(mediaSource);
    audioElement.onended = () => {
      playbackStarted = false;
      resolveAudioFinished("ended");
    };
    audioElement.onerror = () => {
      playbackStarted = false;
      status.innerText = "Bisi’s reply could not be played. Check your device volume and try again.";
      keepListening = false;
      resolveAudioFinished("error");
    };
    mediaSource.addEventListener("sourceopen", () => {
      void (async () => {
        const sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");
        sourceBuffer.mode = "sequence";
        const reader = response.body.getReader();
        streamReader = reader;
        const queuedChunks = [];
        let streamEnded = false;
        let receivedAudio = false;

        const appendNextChunk = () => {
          if (sourceBuffer.updating) return;
          if (queuedChunks.length) {
            sourceBuffer.appendBuffer(queuedChunks.shift());
          } else if (streamEnded && mediaSource.readyState === "open") {
            mediaSource.endOfStream();
          }
        };
        sourceBuffer.addEventListener("updateend", appendNextChunk);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value.byteLength) continue;
          receivedAudio = true;
          queuedChunks.push(value);
          appendNextChunk();
        }
        if (!receivedAudio) {
          throw new Error("The speech service returned an empty audio stream.");
        }
        streamEnded = true;
        appendNextChunk();
      })().catch((error) => {
        if (playbackCancelled) return;
        console.error("Streaming speech playback failed:", error);
        status.innerText = "Bisi’s reply could not be played. Check your connection and try again.";
        keepListening = false;
        resolveAudioFinished("error");
      });
    }, { once: true });

    startPlayback = () => {
      playbackRequested = true;
      if (playbackStarted || playbackPending || !keepListening || !audioElement.buffered.length) return;
      playbackPending = true;
      void audioElement.play().then(() => {
        playbackPending = false;
        playbackStarted = true;
      }).catch((error) => {
        playbackPending = false;
        if (playbackCancelled) return;
        console.error("Streaming audio playback was blocked:", error);
        status.innerText = "Audio playback was blocked. Tap Ask Bisi and try again.";
        keepListening = false;
        resolveAudioFinished("error");
      });
    };

    mediaSource.addEventListener("sourceopen", () => {
      const waitForBuffer = () => {
        if (playbackRequested && audioElement.buffered.length) {
          startPlayback();
          audioElement.removeEventListener("progress", waitForBuffer);
        }
      };
      audioElement.addEventListener("progress", waitForBuffer);
    }, { once: true });

    audioElement.addEventListener("canplay", () => {
      if (playbackRequested) startPlayback();
    });
    audioElement.src = objectUrl;

    const cleanupStream = () => {
      stopPlayback();
      audioElement.onended = null;
      audioElement.onerror = null;
      audioElement.removeAttribute("src");
      audioElement.load();
      URL.revokeObjectURL(objectUrl);
    };

    if (CHROME_AUDIO_ROUTE) {
      let stopInterruptionMonitor = () => {};
      cancelActiveAudio = () => {
        cleanupStream();
        resolveAudioFinished("cancelled");
        stopInterruptionMonitor();
        stopActiveRecording?.();
      };

      let monitor;
      try {
        monitor = await monitorChromeInterruption(
          stopPlayback,
          () => Boolean(playbackStarted && keepListening),
          () => keepListening,
        );
        stopInterruptionMonitor = monitor.stop;
        const interruptionPromise = monitor.recording;
        await monitor.ready;
        if (!keepListening) return null;

        startPlayback();
        const outcome = await Promise.race([
          audioFinished.then(() => ({ type: "finished" })),
          interruptionPromise.then((recording) => ({ type: "interrupted", recording })),
        ]);
        if (outcome.type === "interrupted" && outcome.recording) return outcome.recording;
        if (outcome.type === "interrupted") await audioFinished;
        return null;
      } catch (error) {
        console.warn("Could not monitor for a Chrome voice interruption:", error);
        startPlayback();
        await audioFinished;
        return null;
      } finally {
        cancelActiveAudio = undefined;
        monitor?.stop();
        cleanupStream();
      }
    }

    const recordingPromise = recordAudio({
      waitForSpeechMs: MAX_PLAYBACK_LISTEN_MS,
      onReady: () => {
        if (keepListening) {
          startPlayback();
        } else {
          resolveAudioFinished("cancelled");
        }
      },
      onSpeechStart: () => {
        status.innerText = "I hear you—go ahead.";
        stopPlayback();
      },
    });
    cancelActiveAudio = () => {
      cleanupStream();
      resolveAudioFinished("cancelled");
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
      cleanupStream();
    }
  }

  const audioBuffer = await audioCtx.decodeAudioData(await response.blob().then((blob) => blob.arrayBuffer()));
  startPlayback = () => {
    if (source || !keepListening) return;
    void startBufferedPlayback(audioBuffer).catch((error) => {
      console.error("Playback error:", error);
      status.innerText = error.message || "Bisi’s reply could not be played. Check your device volume and try again.";
      keepListening = false;
      resolveAudioFinished("error");
    });
  };

  // Monitor Chrome's mic without recording until the user actually interrupts.
  if (CHROME_AUDIO_ROUTE) {
    let stopInterruptionMonitor = () => {};
    cancelActiveAudio = () => {
      stopPlayback();
      resolveAudioFinished("cancelled");
      stopInterruptionMonitor();
      stopActiveRecording?.();
    };

    let monitor;
    try {
      monitor = await monitorChromeInterruption(
        stopPlayback,
        () => Boolean(source && keepListening),
        () => keepListening,
      );
      stopInterruptionMonitor = monitor.stop;
      const interruptionPromise = monitor.recording;
      await monitor.ready;
      if (!keepListening) return null;

      startPlayback();
      const outcome = await Promise.race([
        audioFinished.then(() => ({ type: "finished" })),
        interruptionPromise.then((recording) => ({ type: "interrupted", recording })),
      ]);
      if (outcome.type === "interrupted" && outcome.recording) return outcome.recording;
      if (outcome.type === "interrupted") await audioFinished;
      return null;
    } catch (error) {
      console.warn("Could not monitor for a Chrome voice interruption:", error);
      startPlayback();
      await audioFinished;
      return null;
    } finally {
      cancelActiveAudio = undefined;
      monitor?.stop();
      stopPlayback();
    }
  }

  const recordingPromise = recordAudio({
    waitForSpeechMs: MAX_PLAYBACK_LISTEN_MS,
    onReady: () => {
      if (keepListening) {
        startPlayback();
      } else {
        resolveAudioFinished("cancelled");
      }
    },
    onSpeechStart: () => {
      status.innerText = "I hear you—go ahead.";
      stopPlayback();
    },
  });

  cancelActiveAudio = () => {
    stopPlayback();
    resolveAudioFinished("cancelled");
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
    stopPlayback();
  }
}

async function monitorChromeInterruption(stopPlayback, isPlaying, isActive) {
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
  const samples = new Uint8Array(analyser.fftSize);
  const noiseSamples = [];
  let threshold = 0.018;
  let aboveThresholdAt = 0;
  let active = true;
  let handedOff = false;
  let checkInterval;
  let resolveRecording;
  let resolveReady;

  const recording = new Promise((resolve) => {
    resolveRecording = resolve;
  });
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const stop = () => {
    if (!active) return;
    active = false;
    clearInterval(checkInterval);
    microphone.disconnect();
    if (!handedOff) stream.getTracks().forEach((track) => track.stop());
    resolveReady();
    resolveRecording(null);
  };

  checkInterval = setInterval(() => {
    if (!isActive()) {
      stop();
      return;
    }

    analyser.getByteTimeDomainData(samples);
    let sumOfSquares = 0;
    for (const sample of samples) {
      const amplitude = (sample - 128) / 128;
      sumOfSquares += amplitude * amplitude;
    }
    const volume = Math.sqrt(sumOfSquares / samples.length);
    if (noiseSamples.length < 7) {
      noiseSamples.push(volume);
      if (noiseSamples.length === 7) {
        noiseSamples.sort((a, b) => a - b);
        threshold = Math.max(0.012, Math.min(0.035, noiseSamples[3] * 2.5));
        resolveReady();
      }
      return;
    }

    if (!isPlaying()) return;

    const now = Date.now();
    if (volume >= threshold) {
      aboveThresholdAt ||= now;
      if (now - aboveThresholdAt >= MIN_SPEECH_MS) {
        active = false;
        clearInterval(checkInterval);
        microphone.disconnect();
        handedOff = true;
        stopPlayback();
        status.innerText = "I hear you—go ahead.";
        void recordAudio({
          existingStream: stream,
          waitForSpeechMs: MAX_RECORDING_MS,
          speechAlreadyStarted: true,
        }).then(resolveRecording, (error) => {
          stream.getTracks().forEach((track) => track.stop());
          resolveRecording(null);
          console.error("Could not record the interruption:", error);
          status.innerText = getMicrophoneErrorMessage(error);
        });
      }
    } else {
      aboveThresholdAt = 0;
    }
  }, 50);

  return { recording, ready, stop };
}

// === UNLOCK CONTEXT ===
async function unlockAudioContext() {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error("This browser does not support audio playback. Try the latest Safari or Chrome.");
  }
  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new AudioContextConstructor();
    audioContextPrimed = false;
  }
  const resumePromise = audioCtx.state !== "running" ? audioCtx.resume() : Promise.resolve();
  if (!audioContextPrimed) {
    const silentSource = audioCtx.createBufferSource();
    silentSource.buffer = audioCtx.createBuffer(1, 1, audioCtx.sampleRate);
    silentSource.connect(audioCtx.destination);
    silentSource.onended = () => silentSource.disconnect();
    silentSource.start();
    audioContextPrimed = true;
  }
  try {
    await resumePromise;
  } catch (error) {
    console.error("The browser rejected the audio-context resume:", error);
    throw new Error("Your browser blocked audio playback. Check the device's audio output, then tap Ask Bisi to try again.");
  }
  if (audioCtx.state !== "running") {
    throw new Error(`The browser's audio is ${audioCtx.state}. Check the device's audio output, then tap Ask Bisi to try again.`);
  }
}
