import { VoicePipeline } from '../voicePipeline/VoicePipeline';

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

const pipeline = new VoicePipeline({
  livekitUrl: requireEnv('LIVEKIT_URL'),
  livekitToken: requireEnv('LIVEKIT_TOKEN'),
  geminiApiKey: requireEnv('GEMINI_API_KEY'),
  geminiModel: process.env.GEMINI_MODEL,
  elevenLabsApiKey: requireEnv('ELEVENLABS_API_KEY'),
  elevenLabsVoiceId: requireEnv('ELEVENLABS_VOICE_ID'),
  elevenLabsSttModelId: process.env.ELEVENLABS_STT_MODEL_ID,
  elevenLabsTtsModelId: process.env.ELEVENLABS_TTS_MODEL_ID,
  sttLanguageCode: process.env.ELEVENLABS_STT_LANGUAGE,
  sttSegmentSeconds: parseNumber(process.env.STT_SEGMENT_SECONDS),
  wakePhrase: process.env.WAKE_PHRASE ?? 'hey aura',
  sleepPhrase: process.env.SLEEP_PHRASE ?? 'bye aura',
  transcriptionFlushMs: parseNumber(process.env.TRANSCRIPTION_FLUSH_MS),
  audioSampleRate: parseNumber(process.env.LIVEKIT_AUDIO_SAMPLE_RATE),
  audioNumChannels: parseNumber(process.env.LIVEKIT_AUDIO_CHANNELS),
  audioFrameMs: parseNumber(process.env.LIVEKIT_AUDIO_FRAME_MS),
  publishTtsToRoom: parseBool(process.env.PUBLISH_TTS_TO_ROOM),
  ttsDataTopic: process.env.TTS_DATA_TOPIC,
  ttsDataReliable: parseBool(process.env.TTS_DATA_RELIABLE),
  onStateChange: (state) => console.log('[state]', state),
  onTranscript: (text, isFinal) =>
    console.log('[transcript]', text, { isFinal }),
  onGeminiResponse: (text) => console.log('[gemini]', text),
  onAudioReady: (audio) => console.log('[audio-bytes]', audio.byteLength),
  onError: (error) => console.error('[error]', error),
});

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
