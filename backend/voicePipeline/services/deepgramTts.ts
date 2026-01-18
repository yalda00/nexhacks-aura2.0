import { createClient } from '@deepgram/sdk';

export type DeepgramTtsRequest = {
  apiKey: string;
  text: string;
  voiceId?: string; // e.g., 'aura-asteria-en', 'aura-luna-en', 'aura-stella-en'
  modelId?: string;
};

export const synthesizeSpeechDeepgram = async (
  req: DeepgramTtsRequest
): Promise<ArrayBuffer> => {
  try {
    const deepgram = createClient(req.apiKey);

    const response = await deepgram.speak.request(
      { text: req.text },
      {
        model: req.voiceId || req.modelId || 'aura-asteria-en', // Default voice
        encoding: 'linear16',
        sample_rate: 24000,
      }
    );

    // Get the audio stream and convert to ArrayBuffer
    const stream = await response.getStream();

    if (!stream) {
      throw new Error('No audio stream returned from Deepgram');
    }

    // Collect chunks into a buffer
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
      }
    }

    // Concatenate all chunks
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const pcmData = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      pcmData.set(chunk, offset);
      offset += chunk.length;
    }

    // Add WAV header to PCM data so browser can play it
    const sampleRate = 24000;
    const numChannels = 1;
    const bitsPerSample = 16;

    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);

    // "RIFF" chunk descriptor
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, 36 + pcmData.length, true); // file size - 8
    view.setUint32(8, 0x57415645, false); // "WAVE"

    // "fmt " sub-chunk
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true); // subchunk size (16 for PCM)
    view.setUint16(20, 1, true); // audio format (1 = PCM)
    view.setUint16(22, numChannels, true); // number of channels
    view.setUint32(24, sampleRate, true); // sample rate
    view.setUint32(28, sampleRate * numChannels * bitsPerSample / 8, true); // byte rate
    view.setUint16(32, numChannels * bitsPerSample / 8, true); // block align
    view.setUint16(34, bitsPerSample, true); // bits per sample

    // "data" sub-chunk
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, pcmData.length, true); // data size

    // Combine header and PCM data
    const wavFile = new Uint8Array(44 + pcmData.length);
    wavFile.set(new Uint8Array(wavHeader), 0);
    wavFile.set(pcmData, 44);

    return wavFile.buffer;
  } catch (error: any) {
    throw new Error(`Deepgram TTS failed: ${error.message || error}`);
  }
};
