// Load environment variables FIRST
import 'dotenv/config';

import { VoicePipeline } from '../voicePipeline/VoicePipeline';
import { AccessToken } from 'livekit-server-sdk';

/* -------------------- Helpers -------------------- */

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
};

const parseNumber = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseBool = (value: string | undefined): boolean | undefined => {
  if (value === undefined) return undefined;
  return value.toLowerCase() === 'true';
};

/* ---------------- LiveKit Token ------------------ */
/* VoicePipelineConfig expects `livekitToken`, NOT apiKey/apiSecret */

const makeLiveKitToken = async (): Promise<string> => {
  const apiKey = requireEnv('LIVEKIT_API_KEY');
  const apiSecret = requireEnv('LIVEKIT_API_SECRET');
  const room = requireEnv('LIVEKIT_ROOM');
  const identity = process.env.LIVEKIT_IDENTITY ?? 'pipeline-agent';

  const token = new AccessToken(apiKey, apiSecret, { identity });

  token.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  });

  return token.toJwt();
};

/* ----------------- Pipeline ---------------------- */

const pipeline = new VoicePipeline({
  livekitUrl: requireEnv('LIVEKIT_URL'),
  livekitToken: makeLiveKitToken,

  geminiApiKey: requireEnv('GEMINI_API_KEY'),
  geminiModel: process.env.GEMINI_MODEL,

  elevenLabsApiKey: requireEnv('ELEVENLABS_API_KEY'),
  elevenLabsVoiceId: requireEnv('ELEVENLABS_VOICE_ID'),
  elevenLabsSttModelId: process.env.ELEVENLABS_STT_MODEL_ID,
  elevenLabsTtsModelId: process.env.ELEVENLABS_TTS_MODEL_ID,

  sttLanguageCode: process.env.ELEVENLABS_STT_LANGUAGE,
  sttSegmentSeconds: parseNumber(process.env.STT_SEGMENT_SECONDS),
  transcriptionFlushMs: parseNumber(process.env.TRANSCRIPTION_FLUSH_MS),

  audioSampleRate: parseNumber(process.env.LIVEKIT_AUDIO_SAMPLE_RATE),
  audioNumChannels: parseNumber(process.env.LIVEKIT_AUDIO_CHANNELS),
  audioFrameMs: parseNumber(process.env.LIVEKIT_AUDIO_FRAME_MS),

  publishTtsToRoom: parseBool(process.env.PUBLISH_TTS_TO_ROOM),
  publishTtsAudioTrack: parseBool(process.env.PUBLISH_TTS_AUDIO_TRACK),

  ttsAudioSampleRate: parseNumber(process.env.TTS_AUDIO_SAMPLE_RATE),
  ttsAudioChannels: parseNumber(process.env.TTS_AUDIO_CHANNELS),
  ttsAudioFrameMs: parseNumber(process.env.TTS_AUDIO_FRAME_MS),
  ttsAudioTrackName: process.env.TTS_AUDIO_TRACK_NAME,

  wakePhrase: process.env.WAKE_PHRASE ?? 'hey aura',
  sleepPhrase: process.env.SLEEP_PHRASE ?? 'bye aura',

  onStateChange: (state) => console.log('[state]', state),
  onTranscript: (text, isFinal) =>
    console.log('[transcript]', text, { isFinal }),
  onGeminiResponse: (text) => console.log('[gemini]', text),
  onAudioReady: (audio) => console.log('[audio-bytes]', audio.byteLength),
  onError: (error) => console.error('[error]', error),
});

/* ----------------- Lifecycle --------------------- */

const start = async () => {
  console.log('Starting voice pipeline...');
  await pipeline.start();
};

const stop = async () => {
  console.log('Stopping voice pipeline...');
  await pipeline.stop();
};

process.on('SIGINT', () => {
  void stop().finally(() => process.exit(0));
});

void start().catch((error) => {
  console.error(error);
  process.exit(1);
});
