import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(projectRoot, '.env') });

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const port = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, message: 'Bisi voice app is running.' });
});

app.post('/api/chat', async (req, res) => {
  const prompt = req.body?.prompt?.trim();
  if (!prompt) {
    return res.status(400).json({ error: 'A prompt is required.' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'OpenAI API key is not configured. Add OPENAI_API_KEY to your .env file.',
    });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        max_completion_tokens: 96,
        messages: [
          {
            role: 'system',
            content:
              'You are Bisi Silva, a multilingual Nigerian curator and artist reimagined as an AI. Detect the user\'s language and reply warmly in that language. Keep replies concise, usually under 40 words.',
          },
          { role: 'user', content: prompt },
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || 'OpenAI chat request failed.',
      });
    }

    const reply = data.choices?.[0]?.message?.content?.trim() || 'Sorry, I didn’t catch that.';
    return res.json({ reply });
  } catch (error) {
    console.error('Chat API error:', error);
    return res.status(500).json({ error: 'Unable to generate a chat response.' });
  }
});

app.post('/api/transcribe', upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'No audio file uploaded.' });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'ElevenLabs API key is not configured. Add ELEVENLABS_API_KEY to your .env file.',
    });
  }

  try {
    const formData = new FormData();
    formData.append(
      'file',
      new Blob([file.buffer], { type: file.mimetype || 'audio/wav' }),
      file.originalname || 'speech.wav',
    );
    formData.append('model_id', 'scribe_v1');

    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: formData,
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.detail || 'Speech-to-text request failed.',
      });
    }

    return res.json({ text: data.text || '' });
  } catch (error) {
    console.error('Transcription API error:', error);
    return res.status(500).json({ error: 'Unable to transcribe the audio file.' });
  }
});

app.post('/api/tts', async (req, res) => {
  const text = req.body?.text?.trim();
  if (!text) {
    return res.status(400).json({ error: 'Text is required for speech synthesis.' });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || 'Z66ib1spzX3DsbiSJRZK';
  if (!apiKey) {
    return res.status(500).json({
      error: 'ElevenLabs API key is not configured. Add ELEVENLABS_API_KEY to your .env file.',
    });
  }

  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: process.env.ELEVENLABS_TTS_MODEL || 'eleven_flash_v2_5',
        voice_settings: { stability: 0.4, similarity_boost: 0.9 },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const detail = errorData?.detail;
      const message =
        typeof detail === 'string'
          ? detail
          : detail?.message || errorData?.error || 'Text-to-speech request failed.';
      return res.status(response.status).json({
        error: message,
        code: typeof detail === 'object' ? detail?.code : undefined,
      });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    res.setHeader('Content-Type', response.headers.get('content-type') || 'audio/mpeg');
    return res.send(buffer);
  } catch (error) {
    console.error('TTS API error:', error);
    return res.status(500).json({ error: 'Unable to generate speech.' });
  }
});

app.use(express.static(projectRoot));

app.use((req, res) => {
  res.sendFile(path.join(projectRoot, 'index.html'));
});

export default app;

const invokedFile = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedFile === import.meta.url) {
  app.listen(port, () => {
    console.log(`Bisi voice app is running on http://localhost:${port}`);
  });
}
