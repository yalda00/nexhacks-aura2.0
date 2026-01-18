import { createClient } from '@deepgram/sdk';

export type DeepgramSttRequest = {
  apiKey: string;
  samples: Int16Array;
  sampleRate: number;
  languageCode?: string;
};

export const transcribeAudioDeepgram = async (
  req: DeepgramSttRequest
): Promise<string> => {
  try {
    const deepgram = createClient(req.apiKey);

    // Convert Int16Array to Buffer
    const buffer = Buffer.from(req.samples.buffer);

    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
      buffer,
      {
        model: 'nova-2',
        smart_format: true,
        language: req.languageCode || 'en',
        encoding: 'linear16',
        sample_rate: req.sampleRate,
        channels: 1,
      }
    );

    if (error) {
      throw new Error(`Deepgram STT failed: ${error.message}`);
    }

    const transcript = result?.results?.channels?.[0]?.alternatives?.[0]?.transcript;

    if (!transcript) {
      return '';
    }

    return transcript;
  } catch (error: any) {
    throw new Error(`Deepgram STT failed: ${error.message || error}`);
  }
};
