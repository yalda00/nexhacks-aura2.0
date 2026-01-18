import {
  AudioFrame,
  AudioStream,
  Room,
  RoomEvent,
  TrackKind,
} from '@livekit/rtc-node';
import { transcribeAudio } from './services/elevenLabsStt';
import { synthesizeSpeech } from './services/elevenLabsTts';
import { generateGeminiResponse } from './services/gemini';

type VoicePipelineState = 'idle' | 'armed' | 'listening' | 'processing';

type TranscriptMessage = {
  text: string;
  isFinal?: boolean;
};

export type VoicePipelineConfig = {
  livekitUrl: string;
  livekitToken: string | (() => Promise<string>);
  geminiApiKey: string;
  geminiModel?: string;
  elevenLabsApiKey: string;
  elevenLabsVoiceId: string;
  elevenLabsSttModelId?: string;
  elevenLabsTtsModelId?: string;
  sttLanguageCode?: string;
  sttSegmentSeconds?: number;
  wakePhrase?: string;
  sleepPhrase?: string;
  transcriptionFlushMs?: number;
  audioSampleRate?: number;
  audioNumChannels?: number;
  audioFrameMs?: number;
  publishTtsToRoom?: boolean;
  ttsDataTopic?: string;
  ttsDataReliable?: boolean;
  onStateChange?: (state: VoicePipelineState) => void;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onGeminiResponse?: (text: string) => void;
  onAudioReady?: (audio: ArrayBuffer) => void;
  onError?: (error: Error) => void;
};

export class VoicePipeline {
  private readonly config: VoicePipelineConfig;
  private readonly wakePhrase: string;
  private readonly sleepPhrase: string;
  private readonly segmentSeconds: number;
  private room: Room | null = null;
  private running = false;
  private state: VoicePipelineState = 'idle';
  private transcriptBuffer: string[] = [];
  private samplesBuffer: number[] = [];
  private bufferSampleRate: number | null = null;
  private processingStream = false;

  constructor(config: VoicePipelineConfig) {
    this.config = config;
    this.wakePhrase = (config.wakePhrase ?? 'hey aura').toLowerCase();
    this.sleepPhrase = (config.sleepPhrase ?? 'bye aura').toLowerCase();
    this.segmentSeconds = config.sttSegmentSeconds ?? 0.5;
  }

  async start(): Promise<void> {
    if (this.state !== 'idle') return;

    try {
      this.transcriptBuffer = [];
      this.samplesBuffer = [];
      this.running = true;
      this.setState('armed');

      const token =
        typeof this.config.livekitToken === 'string'
          ? this.config.livekitToken
          : await this.config.livekitToken();

      this.room = new Room();
      this.room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== TrackKind.Audio) return;
        if (this.processingStream) return;
        this.processingStream = true;
        void this.processAudioTrack(track).finally(() => {
          this.processingStream = false;
        });
      });

      await this.room.connect(this.config.livekitUrl, token, {
        autoSubscribe: true,
      });
    } catch (error) {
      this.emitError(error);
    }
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.room) {
      await this.room.disconnect();
      this.room = null;
    }

    this.samplesBuffer = [];
    this.transcriptBuffer = [];
    this.setState('idle');
  }

  private async processAudioTrack(track: { kind?: TrackKind }): Promise<void> {
    if (!this.running) return;

    const audioStream = new AudioStream(track as never, {
      sampleRate: this.config.audioSampleRate,
      numChannels: this.config.audioNumChannels ?? 1,
      frameSizeMs: this.config.audioFrameMs,
    });

    const reader = audioStream.getReader();

    while (this.running) {
      const result = await reader.read();
      if (result.done) break;
      if (!result.value) continue;
      await this.handleAudioFrame(result.value);
    }
  }

  private async handleAudioFrame(frame: AudioFrame): Promise<void> {
    if (this.state === 'processing') return;

    const mono = this.toMonoSamples(frame);
    await this.appendSamples(mono, frame.sampleRate);
  }

  private toMonoSamples(frame: AudioFrame): Int16Array {
    const { data, channels, samplesPerChannel } = frame;

    if (channels === 1) {
      return data;
    }

    const mono = new Int16Array(samplesPerChannel);
    for (let i = 0; i < samplesPerChannel; i += 1) {
      let sum = 0;
      for (let ch = 0; ch < channels; ch += 1) {
        sum += data[i * channels + ch];
      }
      mono[i] = Math.round(sum / channels);
    }

    return mono;
  }

  private async appendSamples(samples: Int16Array, sampleRate: number): Promise<void> {
    if (!this.bufferSampleRate) {
      this.bufferSampleRate = sampleRate;
    }

    if (this.bufferSampleRate !== sampleRate) {
      this.samplesBuffer = [];
      this.bufferSampleRate = sampleRate;
    }

    for (let i = 0; i < samples.length; i += 1) {
      this.samplesBuffer.push(samples[i]);
    }

    const segmentSamples = Math.max(1, Math.floor(sampleRate * this.segmentSeconds));
    while (this.samplesBuffer.length >= segmentSamples) {
      const segment = this.samplesBuffer.splice(0, segmentSamples);
      await this.handleAudioSegment(new Int16Array(segment), sampleRate);
    }
  }

  private async handleAudioSegment(samples: Int16Array, sampleRate: number): Promise<void> {
    if (this.state === 'processing') return;

    try {
      const text = await transcribeAudio({
        apiKey: this.config.elevenLabsApiKey,
        samples,
        sampleRate,
        languageCode: this.config.sttLanguageCode,
        modelId: this.config.elevenLabsSttModelId,
      });

      const trimmed = text.trim();
      if (!trimmed) return;

      this.handleTranscript({ text: trimmed, isFinal: true });
    } catch (error) {
      this.emitError(error);
    }
  }

  private handleTranscript(message: TranscriptMessage): void {
    const text = message.text.trim();
    if (!text) return;

    this.config.onTranscript?.(text, Boolean(message.isFinal));

    if (this.state === 'armed') {
      const wakeIndex = text.toLowerCase().indexOf(this.wakePhrase);
      if (wakeIndex === -1) return;

      this.transcriptBuffer = [];
      const afterWake = text.slice(wakeIndex + this.wakePhrase.length).trim();
      if (afterWake) {
        this.transcriptBuffer.push(afterWake);
      }
      this.setState('listening');
      return;
    }

    if (this.state !== 'listening') return;

    const lowerText = text.toLowerCase();
    const sleepIndex = lowerText.indexOf(this.sleepPhrase);
    if (sleepIndex !== -1) {
      const beforeSleep = text.slice(0, sleepIndex).trim();
      if (beforeSleep) {
        this.transcriptBuffer.push(beforeSleep);
      }
      void this.finishListening();
      return;
    }

    this.transcriptBuffer.push(text);
  }

  private async finishListening(): Promise<void> {
    if (this.state !== 'listening') return;
    this.setState('processing');

    const flushMs = this.config.transcriptionFlushMs ?? 300;
    await new Promise((resolve) => setTimeout(resolve, flushMs));

    await this.processTranscriptBuffer();
  }

  private async processTranscriptBuffer(): Promise<void> {
    const prompt = this.transcriptBuffer.join(' ').trim();
    this.transcriptBuffer = [];

    if (!prompt) {
      this.setState('armed');
      return;
    }

    try {
      const responseText = await generateGeminiResponse({
        apiKey: this.config.geminiApiKey,
        model: this.config.geminiModel,
        prompt,
      });
      this.config.onGeminiResponse?.(responseText);

      const audio = await synthesizeSpeech({
        apiKey: this.config.elevenLabsApiKey,
        voiceId: this.config.elevenLabsVoiceId,
        text: responseText,
        modelId: this.config.elevenLabsTtsModelId,
      });
      this.config.onAudioReady?.(audio);

      if (this.config.publishTtsToRoom && this.room?.localParticipant) {
        const topic = this.config.ttsDataTopic ?? 'tts_audio';
        await this.room.localParticipant.publishData(new Uint8Array(audio), {
          reliable: this.config.ttsDataReliable ?? true,
          topic,
        });
      }
    } catch (error) {
      this.emitError(error);
    } finally {
      this.setState('armed');
    }
  }

  private setState(next: VoicePipelineState): void {
    this.state = next;
    this.config.onStateChange?.(next);
  }

  private emitError(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.config.onError?.(normalized);
  }
}
