import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { randomUUID } from 'crypto';
import { AccessToken } from 'livekit-server-sdk';
import { RoomAgentDispatch, RoomConfiguration } from '@livekit/protocol';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const staticRoot = path.join(projectRoot, 'dist');

dotenv.config({ path: path.join(projectRoot, '.env') });

const app = express();
const port = Number(process.env.PORT || 3000);

app.get('/health', (_req, res) => {
  res.json({ ok: true, message: 'Bisi voice app is running.' });
});

app.post('/api/livekit/token', async (_req, res) => {
  const livekitUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!livekitUrl || !apiKey || !apiSecret) {
    return res.status(503).json({
      error: 'LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.',
    });
  }

  try {
    const roomName = `ask-bisi-${randomUUID()}`;
    const identity = `guest-${randomUUID()}`;
    const accessToken = new AccessToken(apiKey, apiSecret, {
      identity,
      name: 'Guest',
      ttl: '10m',
    });
    accessToken.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    accessToken.roomConfig = new RoomConfiguration({
      agents: [
        new RoomAgentDispatch({
          agentName: process.env.LIVEKIT_AGENT_NAME || 'bisi-voice-agent',
        }),
      ],
    });

    return res.status(201).json({
      server_url: livekitUrl,
      participant_token: await accessToken.toJwt(),
    });
  } catch (error) {
    console.error('LiveKit token error:', error);
    return res.status(500).json({ error: 'Unable to start a LiveKit voice session.' });
  }
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route not found.' });
});

app.use(express.static(staticRoot));

app.use((_req, res) => {
  res.sendFile(path.join(staticRoot, 'index.html'));
});

export default app;

const invokedFile = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedFile === import.meta.url) {
  app.listen(port, () => {
    console.log(`Bisi voice app is running on http://localhost:${port}`);
  });
}
