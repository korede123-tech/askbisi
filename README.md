# Bisi – Voice to Voice (Node.js + OpenAI + ElevenLabs)

A minimal system that:
1. Listens to your voice (browser Web Speech API)
2. Converts to text
3. Generates a reply using OpenAI
4. Speaks back with Bisi’s voice using ElevenLabs TTS

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