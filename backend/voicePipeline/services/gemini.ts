export type GeminiRequest = {
  apiKey: string;
  model?: string;
  prompt: string;
};

export const generateGeminiResponse = async (
  request: GeminiRequest
): Promise<string> => {
  const model = request.model ?? 'gemini-1.5-flash';
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
    `?key=${encodeURIComponent(request.apiKey)}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: request.prompt }],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini request failed: ${response.status}`);
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error('Gemini response missing text');
  }

  return text.trim();
};
