import {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
} from '@livekit/rtc-node';
import { transcribeAudio } from './services/elevenLabsStt';
import { synthesizeSpeech, synthesizeSpeechPcm } from './services/elevenLabsTts';
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
  publishTtsAudioTrack?: boolean;
  ttsAudioSampleRate?: number;
  ttsAudioChannels?: number;
  ttsAudioFrameMs?: number;
  ttsAudioTrackName?: string;
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
  private ttsSource: AudioSource | null = null;
  private ttsTrack: LocalAudioTrack | null = null;
  private ttsSampleRate: number | null = null;
  private ttsChannels: number | null = null;

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
        if (track.kind !== TrackKind.KIND_AUDIO) return;
        if (this.processingStream) return;
        this.processingStream = true;
        void this.processAudioTrack(track).finally(() => {
          this.processingStream = false;
        });
      });

      await this.room.connect(this.config.livekitUrl, token, {
        autoSubscribe: true,
        dynacast: false,
      });
    } catch (error) {
      this.emitError(error);
    }
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.room) {
      if (this.ttsTrack?.sid) {
        try {
          await this.room.localParticipant?.unpublishTrack(this.ttsTrack.sid);
        } catch {
          // Ignore publish cleanup errors on shutdown.
        }
      }
      await this.ttsTrack?.close();
      this.ttsTrack = null;
      this.ttsSource = null;
      this.ttsSampleRate = null;
      this.ttsChannels = null;
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

      if (this.config.publishTtsAudioTrack) {
        await this.publishTtsAudioTrack(responseText);
      }
    } catch (error) {
      this.emitError(error);
    } finally {
      this.setState('armed');
    }
  }

  private async publishTtsAudioTrack(text: string): Promise<void> {
    const sampleRate = this.config.ttsAudioSampleRate ?? 16000;
    const channels = this.config.ttsAudioChannels ?? 1;
    const outputFormat = `pcm_${sampleRate}`;

    const pcm = await synthesizeSpeechPcm({
      apiKey: this.config.elevenLabsApiKey,
      voiceId: this.config.elevenLabsVoiceId,
      text,
      modelId: this.config.elevenLabsTtsModelId,
      outputFormat,
      sampleRate,
      channels,
    });

    const normalized =
      pcm.channels === 1 ? pcm.samples : this.mixToMono(pcm.samples, pcm.channels);
    await this.publishPcmAudio(normalized, pcm.sampleRate, 1);
  }

  private mixToMono(samples: Int16Array, channels: number): Int16Array {
    const samplesPerChannel = Math.floor(samples.length / channels);
    const mono = new Int16Array(samplesPerChannel);
    for (let i = 0; i < samplesPerChannel; i += 1) {
      let sum = 0;
      for (let ch = 0; ch < channels; ch += 1) {
        sum += samples[i * channels + ch];
      }
      mono[i] = Math.round(sum / channels);
    }
    return mono;
  }

  private async publishPcmAudio(
    samples: Int16Array,
    sampleRate: number,
    channels: number
  ): Promise<void> {
    if (!this.room?.localParticipant) return;

    const source = await this.ensureTtsSource(sampleRate, channels);
    if (!source) return;

    const frameMs = this.config.ttsAudioFrameMs ?? 20;
    const samplesPerChannel = Math.max(1, Math.floor((sampleRate * frameMs) / 1000));
    const frameSize = samplesPerChannel * channels;

    for (let offset = 0; offset < samples.length; offset += frameSize) {
      const frameSamples =
        offset + frameSize <= samples.length
          ? samples.subarray(offset, offset + frameSize)
          : this.padFrame(samples.subarray(offset), frameSize);
      const frame = new AudioFrame(
        frameSamples,
        sampleRate,
        channels,
        samplesPerChannel
      );
      await source.captureFrame(frame);
    }

    await source.waitForPlayout();
  }

  private padFrame(samples: Int16Array, frameSize: number): Int16Array {
    const padded = new Int16Array(frameSize);
    padded.set(samples);
    return padded;
  }

  private async ensureTtsSource(
    sampleRate: number,
    channels: number
  ): Promise<AudioSource | null> {
    if (!this.room?.localParticipant) return null;

    if (this.ttsSource && this.ttsTrack) {
      if (this.ttsSampleRate !== sampleRate || this.ttsChannels !== channels) {
        throw new Error(
          `TTS audio format mismatch: expected ${this.ttsSampleRate}Hz/${this.ttsChannels}ch, got ${sampleRate}Hz/${channels}ch`
        );
      }
      return this.ttsSource;
    }

    const source = new AudioSource(sampleRate, channels);
    const trackName = this.config.ttsAudioTrackName ?? 'aura-tts';
    const track = LocalAudioTrack.createAudioTrack(trackName, source);
    await this.room.localParticipant.publishTrack(
      track,
      new TrackPublishOptions({
        source: TrackSource.SOURCE_MICROPHONE,
      })
    );

    this.ttsSource = source;
    this.ttsTrack = track;
    this.ttsSampleRate = sampleRate;
    this.ttsChannels = channels;

    return source;
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
