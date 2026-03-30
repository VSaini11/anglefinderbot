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
  const prompt = `You are an expert social media content strategist.
Analyze this website and extract marketing angles that work across ANY niche.

CRITICAL RULES:
1. Each angle must be a DIFFERENT emotional trigger category.
2. Do NOT repeat the same emotion or theme twice.
3. Strip any niche-specific product names, brand names, or jargon — keep angles generic enough to work in fitness, business, lifestyle, etc.
4. Each angle should be a short, punchy hook — under 8 words.

You MUST extract exactly one angle from each of these 6 categories (in order):
1. FOMO / Urgency (fear of missing out or running out of time)
2. Social Proof / Authority (others trust it, experts endorse it)
3. Transformation / Before–After (life before vs after using it)
4. Pain Point / Problem (highlighting a frustration the audience has)
5. Curiosity / Intrigue (make them want to know more)
6. Aspiration / Desire (dream outcome, lifestyle, financial freedom)

Return ONLY a numbered list, one angle per line, no explanations, no category labels.

Website Content:
${websiteContent}`;

  const raw = await callGeminiWithRetry(prompt);
  const angles = parseAngles(raw);

  if (angles.length === 0) throw new Error('AI returned no angles');

  return angles;
}

module.exports = { extractAngles };
