export type ElevenLabsTtsRequest = {
  apiKey: string;
  voiceId: string;
  text: string;
  modelId?: string;
};

export const synthesizeSpeech = async (
  request: ElevenLabsTtsRequest
): Promise<ArrayBuffer> => {
  const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${request.voiceId}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': request.apiKey,
    },
    body: JSON.stringify({
      text: request.text,
      model_id: request.modelId ?? 'eleven_multilingual_v2',
    }),
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs TTS failed: ${response.status}`);
  }

  return response.arrayBuffer();
};
