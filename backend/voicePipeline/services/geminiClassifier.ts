export type GeminiClassifierRequest = {
  apiKey: string;
  model?: string;
  text: string;
};

export type GeminiClassifierResult = {
  wake: boolean;
  stop: boolean;
};

// Rate limiting: track last call time
let lastGeminiCall = 0;
const MIN_CALL_INTERVAL_MS = 2000; // Max 1 call per 2 seconds

// Simple keyword-based detection (fast, no API calls)
const simpleKeywordDetection = (text: string): GeminiClassifierResult | null => {
  // Strip punctuation and normalize
  const normalized = text.toLowerCase().trim().replace(/[.,!?;:]/g, ' ');

  // Stop word patterns - CHECK FIRST (higher priority)
  const stopPatterns = [
    /\bbye\b/i,  // Just "bye" alone
    /\bgoodbye\b/i,  // Just "goodbye" alone
    /\b(bye|goodbye|stop|cancel|shut up|nevermind|that's all)\s+(aura|ora|oro|or\s*uh)\b/i,
    /\bbye\s+aura\b/i,
    /\bgoodbye\s+aura\b/i,
    /\bbye\s+oro\b/i,
    /\bbye\s+or\s*uh\b/i,
    /\b(bye|by)\s+or\b/i,  // "by or" misheard
    /\bgoodbye\s+oro\b/i,
    /\bstop\s+aura\b/i,
    /\bcancel\b/i,
    /\bnevermind\b/i,
  ];

  // Wake word patterns (variations of "hey aura", "hi aura", etc.)
  const wakePatterns = [
    /\b(hey|hi|hello|yo|ok)\s+(aura|ora|or uh|aara)\b/i,
    /\b(hey|hi)\s+or\b/i,  // Misheard as "hey or"
  ];

  // Check stop FIRST - if it's a stop word, don't check wake
  const hasStop = stopPatterns.some(pattern => pattern.test(normalized));
  if (hasStop) {
    return { wake: false, stop: true };
  }

  const hasWake = wakePatterns.some(pattern => pattern.test(normalized));

  // Always return a result (never return null to avoid Gemini API calls)
  return { wake: hasWake, stop: false };
};

// Gemini API call with rate limiting
const callGeminiAPI = async (
  req: GeminiClassifierRequest
): Promise<GeminiClassifierResult> => {
  const model = req.model ?? "gemini-1.5-flash";
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
    `?key=${encodeURIComponent(req.apiKey)}`;

  const prompt = `
You are a strict JSON classifier for a voice assistant named "Aura".

Return ONLY valid JSON with this schema:
{"wake": boolean, "stop": boolean}

Rules:
- wake=true if the user is clearly addressing Aura (examples: "hey aura", "hi aura", "aura", "yo aura", "ok aura", "hey ora", "hey or", "hey or uh" (misheard)).
- stop=true if the user is clearly ending the interaction (examples: "stop aura", "bye aura", "that's all aura", "cancel", "nevermind", "shut up aura").
- If both appear, set both true.
- If neither appears, set both false.

Text:
"""${req.text}"""
`.trim();

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini classifier failed: ${response.status}`);
  }

  const payload = await response.json();
  const raw = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) return { wake: false, stop: false };

  // extract first JSON object
  const match = String(raw).match(/\{[\s\S]*\}/);
  if (!match) return { wake: false, stop: false };

  try {
    const parsed = JSON.parse(match[0]);
    return {
      wake: Boolean(parsed?.wake),
      stop: Boolean(parsed?.stop),
    };
  } catch {
    return { wake: false, stop: false };
  }
};

export const classifyWakeStop = async (
  req: GeminiClassifierRequest
): Promise<GeminiClassifierResult> => {
  // Step 1: Try simple keyword detection first (fast, free)
  const keywordResult = simpleKeywordDetection(req.text);
  if (keywordResult !== null) {
    return keywordResult;
  }

  // Step 2: If ambiguous, check rate limit before calling Gemini
  const now = Date.now();
  const timeSinceLastCall = now - lastGeminiCall;

  if (timeSinceLastCall < MIN_CALL_INTERVAL_MS) {
    // Rate limited - return conservative default
    console.log('[classifier] Rate limited, using default (no wake/stop detected)');
    return { wake: false, stop: false };
  }

  // Step 3: Call Gemini API
  try {
    lastGeminiCall = now;
    return await callGeminiAPI(req);
  } catch (error) {
    // If Gemini fails (rate limit, network error, etc.), fall back to no detection
    console.error('[classifier] Gemini API failed, falling back to keyword detection:', error);
    return { wake: false, stop: false };
  }
};
