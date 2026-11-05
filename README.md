# Ask Bisi

Ask Bisi is a realtime voice conversation app. The browser connects to LiveKit
over WebRTC; a separately deployed LiveKit agent handles streaming speech
recognition, OpenAI responses, and ElevenLabs speech synthesis. The web app and
short-lived room-token endpoint run on Vercel.

## Run the web app locally

```bash
npm install
cp .env.example .env
# Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET in .env.
npm run dev
```

Open the Vite URL printed in the terminal. The token endpoint is proxied to the
local Express server. The voice agent must also be running and configured before
a conversation can start.

## Run the LiveKit agent locally

In another terminal:

```bash
cd livekit-agent
npm install
cp .env.example .env
# Set LiveKit credentials and your OpenAI and ElevenLabs keys in this .env.
npm run dev
```

The worker and web app must use credentials from the same LiveKit project. Keep
the provider keys in the agent environment; they are never sent to the browser.

## Deploy

### Vercel web app

Import the repository into Vercel. Set these project environment variables:

- `LIVEKIT_URL` — the LiveKit project's WebSocket URL.
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `LIVEKIT_AGENT_NAME` — optional; defaults to `bisi-voice-agent`.

Vercel builds the Vite frontend and serves the API function. Redeploy after
adding or changing environment variables.

### LiveKit agent

Deploy the `livekit-agent` directory as a LiveKit Cloud agent (or another
persistent Node.js worker). Configure these worker environment variables:

- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` — from the same
  LiveKit project as the Vercel app.
- `LIVEKIT_AGENT_NAME` — optional; defaults to `bisi-voice-agent`.
- `OPENAI_API_KEY`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID` — optional; defaults to the configured Bisi voice.
- `ELEVENLABS_TTS_MODEL` — optional; defaults to `eleven_flash_v2_5`.

Set the worker's registered agent name to `bisi-voice-agent`, or set
`LIVEKIT_AGENT_NAME` in Vercel to match the worker. A Vercel function cannot run
the persistent LiveKit worker.

The token endpoint issues a short-lived participant token for a new private
room. For a public production app, enable rate limiting or authentication at
the edge to prevent automated session creation.
