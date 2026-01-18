// Load environment variables FIRST
import 'dotenv/config';

import { VoicePipeline } from '../voicePipeline/VoicePipeline';
import { AccessToken } from 'livekit-server-sdk';
import { HttpBridgeWebSocketServer } from '../httpWebsocketServer';

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

// Track pipeline state to only send transcripts during listening phase
let currentState: 'idle' | 'armed' | 'listening' | 'processing' = 'idle';
let accumulatedQuery: string[] = []; // Buffer to accumulate query during listening

// Declare pipeline variable first so it can be referenced in callbacks
let pipeline: VoicePipeline;

/* ----------------- WebSocket Bridge -------------- */

const bridgeServer = new HttpBridgeWebSocketServer({
  port: parseNumber(process.env.BRIDGE_WS_PORT) ?? 8765,
  onClaudeResponse: async (response) => {
    console.log('\n========================================');
    console.log('🎯 CLAUDE RESPONSE RECEIVED');
    console.log('========================================');
    console.log('Response:', JSON.stringify(response, null, 2));

    // Extract text from response and speak it
    try {
      let textToSpeak: string | null = null;

      // Handle different response formats
      if (typeof response === 'string') {
        textToSpeak = response;
      } else if (response && typeof response === 'object') {
        // Response format: { text: "...", options: [...] }
        if ('text' in response && typeof response.text === 'string') {
          textToSpeak = response.text;
        }
        // Check for nested content.text (from Claude console)
        else if ('content' in response && response.content && typeof response.content === 'object' && 'text' in response.content && typeof response.content.text === 'string') {
          textToSpeak = response.content.text;
        }
        // Fallback: check for content field as string
        else if ('content' in response && typeof response.content === 'string') {
          textToSpeak = response.content;
        }
      }

      if (textToSpeak && textToSpeak.trim()) {
        console.log('\n🔊 STARTING TTS (WebSocket Mode)');
        console.log('Text:', textToSpeak);
        console.log('Calling Deepgram TTS API...\n');

        // Generate MP3 audio with Deepgram
        const { synthesizeSpeechDeepgram } = await import('../voicePipeline/services/deepgramTts');
        const audio = await synthesizeSpeechDeepgram({
          apiKey: requireEnv('DEEPGRAM_API_KEY'),
          text: textToSpeak,
          voiceId: process.env.DEEPGRAM_VOICE_ID || 'aura-asteria-en',
        });

        // Send audio to browser via WebSocket
        bridgeServer.sendAudio(audio);

        console.log('\n✅ TTS COMPLETED!');
        console.log('Audio sent to browser via WebSocket.');
        console.log('========================================\n');
      } else {
        console.warn('\n⚠️  NO TEXT TO SPEAK');
        console.log('Response had no text content');
        console.log('========================================\n');
      }
    } catch (error) {
      console.error('\n❌ TTS FAILED');
      console.error('Error:', error);
      console.log('========================================\n');
    }
  },
  onError: (error) => {
    console.error('[bridge] WebSocket error:', error);
  },
});

/* ----------------- Initialize Pipeline ----------- */

pipeline = new VoicePipeline({
  livekitUrl: requireEnv('LIVEKIT_URL'),
  livekitToken: makeLiveKitToken,

  geminiApiKey: requireEnv('GEMINI_API_KEY'),
  geminiModel: process.env.GEMINI_MODEL,

  elevenLabsApiKey: requireEnv('ELEVENLABS_API_KEY'),
  elevenLabsVoiceId: requireEnv('ELEVENLABS_VOICE_ID'),
  elevenLabsSttModelId: process.env.ELEVENLABS_STT_MODEL_ID,
  elevenLabsTtsModelId: process.env.ELEVENLABS_TTS_MODEL_ID,
  deepgramApiKey: process.env.DEEPGRAM_API_KEY, // Backup STT provider

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

  onStateChange: (state) => {
    currentState = state;
    console.log('[state]', state);

    // When entering listening state, clear accumulated query
    if (state === 'listening') {
      accumulatedQuery = [];
      console.log('[bridge] Started listening, accumulating query...');
    }

    // When entering processing state, send the complete accumulated query
    if (state === 'processing') {
      console.log('[bridge] Entering processing state. Accumulated query:', accumulatedQuery);

      if (accumulatedQuery.length > 0) {
        const fullQuery = accumulatedQuery.join(' ').trim();
        console.log('[bridge] ✅ Sending complete query to Claude:', fullQuery);

        if (fullQuery) {
          bridgeServer.sendTranscript(fullQuery);
        } else {
          console.warn('[bridge] ⚠️  Query was empty after joining!');
        }
      } else {
        console.warn('[bridge] ⚠️  No query accumulated! Array was empty.');
      }

      accumulatedQuery = []; // Clear buffer
    }
  },
  onTranscript: (text, isFinal) => {
    console.log('[transcript]', text, { isFinal });

    if (isFinal && text.trim()) {
      // Always send to browser for display
      bridgeServer.sendTranscriptDisplay(text);

      // During listening state, accumulate transcripts (don't send yet)
      if (currentState === 'listening') {
        console.log('[bridge] 🎤 In listening state, processing transcript:', text);

        // Strip wake/stop words before accumulating
        let cleanedText = text
          .replace(/\b(hey|hi|hello|yo|ok)\s+(aura|ora|or\s*uh|aara)\b/gi, '')
          .replace(/\b(bye|goodbye|stop|cancel|shut up|nevermind|that's all)\s+(aura|ora|oro|or\s*uh)\b/gi, '')
          .replace(/\b(bye|goodbye)\s+(oro|or\s*uh)\b/gi, '')
          .replace(/\b(bye)\b/gi, '')  // Remove standalone "bye"
          .replace(/\bgoodbye\b/gi, '')  // Remove standalone "goodbye"
          .replace(/\baura\b/gi, '')
          .replace(/\boro\b/gi, '')
          .replace(/\bor\s*uh\b/gi, '')
          .replace(/[,!?]+$/g, '')  // Remove trailing punctuation
          .trim();

        console.log('[bridge] 🧹 After cleaning:', cleanedText);

        // Accumulate if there's actual content after filtering
        if (cleanedText) {
          accumulatedQuery.push(cleanedText);
          console.log('[bridge] ✅ Accumulated! Total segments:', accumulatedQuery.length);
          console.log('[bridge] 📝 Current query:', accumulatedQuery.join(' '));
        } else {
          console.log('[bridge] ⚠️  Cleaned text was empty, not accumulating');
        }
      } else {
        console.log('[bridge] ℹ️  Not in listening state (current:', currentState, '), not accumulating');
      }
    }
  },
  onGeminiResponse: (text) => {
    console.log('[gemini]', text);
    // Optionally send Gemini's response to the bridge as well
    // bridgeServer.broadcast(JSON.stringify({ type: 'gemini_response', content: text }));
  },
  onAudioReady: (audio) => console.log('[audio-bytes]', audio.byteLength),
  onError: (error) => console.error('[error]', error),
});

/* ----------------- Lifecycle --------------------- */

const start = async () => {
  console.log('Starting bridge server...');
  await bridgeServer.start();
  console.log('Starting voice pipeline...');
  await pipeline.start();
};

const stop = async () => {
  console.log('Stopping voice pipeline...');
  await pipeline.stop();
  await bridgeServer.close();
};

process.on('SIGINT', () => {
  void stop().finally(() => process.exit(0));
});

void start().catch((error) => {
  console.error(error);
  process.exit(1);
});
