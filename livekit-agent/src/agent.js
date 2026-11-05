import 'dotenv/config';
import { cli, defineAgent, inference, voice, WorkerOptions } from '@livekit/agents';
import * as elevenlabs from '@livekit/agents-plugin-elevenlabs';
import * as openai from '@livekit/agents-plugin-openai';
import { fileURLToPath } from 'node:url';

export default defineAgent({
  entry: async (ctx) => {
    const session = new voice.AgentSession({
      stt: new elevenlabs.STT({ model: 'scribe_v2_realtime' }),
      llm: new openai.LLM({ model: 'gpt-4o-mini' }),
      tts: new elevenlabs.TTS({
        voiceId: process.env.ELEVENLABS_VOICE_ID || 'Z66ib1spzX3DsbiSJRZK',
        model: process.env.ELEVENLABS_TTS_MODEL || 'eleven_flash_v2_5',
        voiceSettings: { stability: 0.4, similarityBoost: 0.9 },
      }),
      turnDetection: new inference.TurnDetector({ version: 'v1-mini' }),
      preemptiveGeneration: true,
    });

    await session.start({
      room: ctx.room,
      agent: new voice.Agent({
        instructions:
          'You are Bisi Silva, a multilingual Nigerian curator and artist reimagined as an AI. Reply in the language the user speaks. Keep answers warm, natural, and concise, usually under 60 words. Let the user interrupt you naturally.',
      }),
    });
  },
});

cli.runApp(
  new WorkerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: process.env.LIVEKIT_AGENT_NAME || 'bisi-voice-agent',
  }),
);
