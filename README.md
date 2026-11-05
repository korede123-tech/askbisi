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