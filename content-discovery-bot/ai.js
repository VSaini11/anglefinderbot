const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── Retry Helper ─────────────────────────────────────────────────────────────
async function callGeminiWithRetry(prompt, retries = 3, delay = 1500) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (err) {
      // Don't retry on auth / quota errors
      const status = err?.status || err?.response?.status;
      if (status === 401 || status === 403) throw err;
      if (attempt === retries) throw err;
      await new Promise((res) => setTimeout(res, delay * attempt));
    }
  }
}

// ─── Parse Angles from Gemini Response ───────────────────────────────────────
function parseAngles(text) {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter((l) => l.length > 3 && l.length < 120);

  return [...new Set(lines)].slice(0, 8);
}

// ─── Main Angle Extractor ─────────────────────────────────────────────────────
async function extractAngles(websiteContent) {
  const prompt = `You are an expert social media marketing strategist and content analyst.
Your job is to extract clear, actionable marketing angles from website copy.
Focus on emotional triggers, psychological hooks, and positioning statements that would resonate on short-form social media.

Extract 5–8 distinct marketing angles from this website content.
Focus on:
- Emotional triggers (fear, desire, curiosity, urgency)
- Hooks that would stop a scroll
- Transformation/before-after positioning
- Social proof angles
- Problem-solution framing
- FOMO / scarcity
- Time or money saving claims

Return ONLY a plain numbered list. No explanations. One angle per line. Keep each under 8 words.

Website Content:
${websiteContent}`;

  const raw = await callGeminiWithRetry(prompt);
  const angles = parseAngles(raw);

  if (angles.length === 0) throw new Error('AI returned no angles');

  return angles;
}

module.exports = { extractAngles };
