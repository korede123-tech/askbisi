import { Room, RoomEvent, Track, createLocalAudioTrack } from 'livekit-client';

const voiceButton = document.querySelector('#startBtn');
const statusText = document.querySelector('#status');
const glow = document.querySelector('.mic-wrapper');

let room;
let microphoneTrack;
let audioContext;
let analyser;
let animationFrame;

function setStatus(message) {
  if (statusText) statusText.textContent = message;
}

function setButtonState(state) {
  if (!voiceButton) return;
  voiceButton.dataset.state = state;
  voiceButton.setAttribute('aria-label', {
    idle: 'Start talking with Bisi',
    connecting: 'Connecting to Bisi',
    connected: 'End conversation with Bisi',
  }[state]);
  voiceButton.setAttribute('aria-pressed', String(state === 'connected'));
  voiceButton.disabled = state === 'connecting';
}

function stopGlowMeter() {
  cancelAnimationFrame(animationFrame);
  analyser = undefined;
  if (glow) {
    glow.style.setProperty('--voice-glow-opacity', '0.2');
    glow.style.setProperty('--voice-glow-scale', '1');
    glow.style.setProperty('--voice-core-scale', '1');
  }
}

function startGlowMeter(track) {
  const audioTrack = track.mediaStreamTrack;
  if (!audioTrack || !glow) return;

  audioContext ??= new AudioContext();
  if (audioContext.state === 'suspended') void audioContext.resume();

  const source = audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  const samples = new Uint8Array(analyser.frequencyBinCount);
  const updateLevel = () => {
    if (!analyser) return;
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) {
      const amplitude = (sample - 128) / 128;
      sum += amplitude * amplitude;
    }
    const level = Math.min(1, Math.sqrt(sum / samples.length) * 4);
    glow.style.setProperty('--voice-glow-opacity', (0.2 + level * 0.75).toFixed(2));
    glow.style.setProperty('--voice-glow-scale', (1 + level * 0.35).toFixed(2));
    glow.style.setProperty('--voice-core-scale', (1 + level * 0.2).toFixed(2));
    animationFrame = requestAnimationFrame(updateLevel);
  };
  updateLevel();
}

function cleanUpAudio() {
  stopGlowMeter();
  microphoneTrack?.stop();
  microphoneTrack = undefined;
  document.querySelectorAll('[data-livekit-audio]').forEach((audio) => audio.remove());
}

function attachRemoteAudio(track) {
  if (track.kind !== Track.Kind.Audio) return;
  const element = track.attach();
  element.autoplay = true;
  element.setAttribute('playsinline', '');
  element.dataset.livekitAudio = 'true';
  document.body.append(element);
  void element.play().catch(() => {
    setStatus('Bisi is ready. Tap the page to enable audio playback.');
    const retryPlayback = () => {
      void element.play().catch(() => {
        setStatus('Audio playback is blocked. Check Safari’s site settings and try again.');
      });
    };
    document.addEventListener('pointerdown', retryPlayback, { once: true });
  });
}

async function endConversation() {
  const activeRoom = room;
  room = undefined;
  if (activeRoom) await activeRoom.disconnect();
  cleanUpAudio();
  setButtonState('idle');
  setStatus('Conversation ended.');
}

async function startConversation() {
  setButtonState('connecting');
  setStatus('Connecting securely…');

  try {
    audioContext ??= new AudioContext();
    const audioResume = audioContext.resume().catch((error) => {
      console.warn('Unable to resume the voice animation audio context:', error);
    });
    const microphonePromise = createLocalAudioTrack({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    }).then((track) => {
      microphoneTrack = track;
      return track;
    });
    const tokenPromise = fetch('/api/livekit/token', { method: 'POST' }).then(async (response) => {
      const tokenData = await response.json();
      if (!response.ok) {
        throw new Error(tokenData.error || 'Unable to start a voice session.');
      }
      return tokenData;
    });
    const [tokenData, track] = await Promise.all([tokenPromise, microphonePromise]);

    const activeRoom = new Room({ adaptiveStream: true, dynacast: true });
    room = activeRoom;
    activeRoom.on(RoomEvent.TrackSubscribed, (track) => attachRemoteAudio(track));
    activeRoom.on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((element) => element.remove()));
    activeRoom.on(RoomEvent.Disconnected, () => {
      if (room !== activeRoom) return;
      room = undefined;
      cleanUpAudio();
      setButtonState('idle');
      setStatus('Connection ended.');
    });

    microphoneTrack = track;
    await audioResume;
    startGlowMeter(microphoneTrack);
    await activeRoom.connect(tokenData.server_url, tokenData.participant_token);
    await activeRoom.localParticipant.publishTrack(microphoneTrack);

    setButtonState('connected');
    setStatus('You’re connected. Speak naturally — you can interrupt Bisi anytime.');
  } catch (error) {
    console.error('Unable to start voice conversation:', error);
    const activeRoom = room;
    room = undefined;
    if (activeRoom) await activeRoom.disconnect();
    cleanUpAudio();
    setButtonState('idle');
    setStatus(error instanceof Error ? error.message : 'Unable to connect. Please try again.');
  }
}

voiceButton?.addEventListener('click', () => {
  if (room) {
    void endConversation();
  } else {
    void startConversation();
  }
});

setButtonState('idle');
