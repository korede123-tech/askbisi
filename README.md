# Ask Bisi – Voice to Voice (Node.js + OpenAI + ElevenLabs)

Ask Bisi records speech in the browser, transcribes it with ElevenLabs, generates
a response with OpenAI, and speaks using ElevenLabs TTS.

## Run

```bash
npm install
cp .env.example .env  # add your OpenAI and ElevenLabs API keys
npm run dev           # or npm start
```

## Deploy to Vercel

1. Import this repository into Vercel and deploy it as a Node.js project.
2. In **Project Settings → Environment Variables**, add:
   - `OPENAI_API_KEY`
   - `ELEVENLABS_API_KEY`
   - `ELEVENLABS_VOICE_ID` (defaults to the configured voice ID)
   - `ELEVENLABS_TTS_MODEL` (optional; defaults to the faster `eleven_flash_v2_5`)
   - `OPENAI_MODEL` (optional; defaults to `gpt-4o-mini`)
3. Redeploy after saving the environment variables.

The `.env` file is for local development only and is ignored by Git. Vercel uses
the environment variables set in the project dashboard.

## Use on iPhone or iPad

Open the deployed site in Safari over HTTPS and allow microphone access when
prompted. If access was previously denied, enable it for the site in iOS
Settings, then reload the page. Audio recording requires a secure connection;
the local-network development server is not a suitable iPhone test URL.

The browser selects a recording format supported by the device (MP4 on Safari
when available) and sends it to the existing transcription endpoint. LiveKit
environment variables are not used by this restored version.
