const axios = require('axios');
const { scrapeEngagement } = require('./scraper');

const SERP_API_URL = 'https://serpapi.com/search.json';

// ─── Platform Detection ───────────────────────────────────────────────────────
function detectPlatform(link) {
  if (link.includes('tiktok.com')) return 'TikTok';
  if (link.includes('instagram.com')) return 'Instagram';
  if (link.includes('facebook.com') || link.includes('fb.com')) return 'Facebook';
  return 'Unknown';
}

// ─── Format Detection via Keyword Heuristics ─────────────────────────────────
const FORMAT_KEYWORDS = {
  Slideshow: ['slideshow', 'slides', 'swipe', 'carousel', 'part 1', 'part 2', 'gallery'],
  'Text-on-Screen': ['text on screen', 'text over', 'words on', 'caption', 'subtitles', 'on screen text'],
  Meme: ['meme', 'funny', 'lol', 'relatable', 'when you', 'pov:', 'nobody:', 'me when'],
  Animation: ['animation', 'animated', 'motion graphic', 'cartoon', 'explainer'],
  'Screen Recording': [
    'screen recording',
    'screen record',
    'screencast',
    'tutorial',
    'how to',
    'step by step',
    'walkthrough',
    'demo',
  ],
};

const REJECT_KEYWORDS = [
  'talking head',
  'talking to camera',
  'face cam',
  'vlog',
  'cinematic',
  'b-roll',
  'drone footage',
  'professional video',
  'high quality production',
  'watermark',
  'copyright',
  'studio',
  'film',
];

function detectFormat(title = '', snippet = '') {
  const text = `${title} ${snippet}`.toLowerCase();

  for (const kw of REJECT_KEYWORDS) {
    if (text.includes(kw)) return null;
  }

  for (const [format, keywords] of Object.entries(FORMAT_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw)) return format;
    }
  }

  return 'Text-on-Screen';
}

// ─── Parse Engagement ─────────────────────────────────────────────────────────
// Accepts a full result object so we can check structured video fields first,
// then fall back to snippet regex for organic results.
function parseEngagement(result = {}) {
  // 1. Direct structured fields from video search results (tbm=vid)
  if (result.views) return result.views; // e.g. "1.2M views"
  if (result.view_count) return `${result.view_count} views`;

  // 2. Snippet-based regex fallback for organic results
  const snippet = result.snippet || '';
  const patterns = [
    /(\d[\d,.]+[KkMm]?)\s*(likes?|views?|hearts?|reactions?)/i,
    /(\d[\d,.]+[KkMm]?)\s*💕/,
    /(\d[\d,.]+[KkMm]?)\s*❤/,
  ];
  for (const pattern of patterns) {
    const match = snippet.match(pattern);
    if (match) return match[1] + (match[2] ? ' ' + match[2] : '');
  }

  return null;
}

// ─── Build Queries ────────────────────────────────────────────────────────────
// Returns two sets:
//   videoQueries  — use tbm=vid (structured view counts)
//   organicQueries — fallback organic search for broader coverage
function buildQueries(angles) {
  const topAngles = angles.slice(0, 4);

  const videoQueries = [];
  const organicQueries = [];

  const videoPlatforms = [
    { site: 'site:tiktok.com', label: 'tiktok' },
    { site: 'site:instagram.com', label: 'instagram' },
    { site: 'site:facebook.com/watch OR site:facebook.com/reel', label: 'facebook' },
  ];

  topAngles.forEach((angle, i) => {
    const platform = videoPlatforms[i % videoPlatforms.length];
    // Primary: video search
    videoQueries.push({
      query: `${platform.site} "${angle}"`,
      angle,
      platform: platform.label,
      mode: 'video',
    });
    // Fallback: organic search
    organicQueries.push({
      query: `${platform.site} "${angle}"`,
      angle,
      platform: platform.label,
      mode: 'organic',
    });
  });

  // Extra coverage queries (video mode)
  if (topAngles.length > 0) {
    videoQueries.push({
      query: `site:tiktok.com "${topAngles[0]}"`,
      angle: topAngles[0],
      platform: 'tiktok',
      mode: 'video',
    });
    videoQueries.push({
      query: `site:instagram.com "${topAngles[1] || topAngles[0]}"`,
      angle: topAngles[1] || topAngles[0],
      platform: 'instagram',
      mode: 'video',
    });
  }

  return { videoQueries, organicQueries };
}

// ─── Fetch One Query via SerpAPI ──────────────────────────────────────────────
async function fetchQuery({ query, angle, mode }, retries = 2, delay = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const params = {
        q: query,
        api_key: process.env.SERP_API_KEY,
        num: 5,
        hl: 'en',
        gl: 'us',
      };

      // Video search mode: returns structured view counts
      if (mode === 'video') params.tbm = 'vid';

      const response = await axios.get(SERP_API_URL, { params, timeout: 15000 });

      // Video search returns video_results; organic returns organic_results
      const items =
        response.data?.video_results ||
        response.data?.organic_results ||
        [];

      return items
        .map((r) => {
          const link = r.link || '';
          const title = r.title || '';
          const snippet = r.snippet || '';
          const platform = detectPlatform(link);

          if (platform === 'Unknown') return null;

          const format = detectFormat(title, snippet);
          if (!format) return null;

          return {
            link,
            platform,
            engagement: parseEngagement(r),   // pass full object
            format,
            angle,
          };
        })
        .filter(Boolean);
    } catch (err) {
      if (attempt === retries) {
        console.error(`SerpAPI error [${mode}] for "${query}":`, err.message);
        return [];
      }
      await new Promise((res) => setTimeout(res, delay * attempt));
    }
  }
  return [];
}

// ─── Main Search Orchestrator ─────────────────────────────────────────────────
async function searchContent(angles) {
  const { videoQueries, organicQueries } = buildQueries(angles);
  const allResults = [];
  const seenLinks = new Set();

  const addResults = (results) => {
    for (const result of results) {
      if (!seenLinks.has(result.link)) {
        seenLinks.add(result.link);
        allResults.push(result);
      }
    }
  };

  // ── Phase 1: Video search (best engagement data) ──
  for (const queryObj of videoQueries) {
    if (allResults.length >= 15) break;
    const results = await fetchQuery(queryObj);
    addResults(results);
    await new Promise((res) => setTimeout(res, 500));
  }

  // ── Phase 2: Organic fallback if not enough results ──
  if (allResults.length < 10) {
    for (const queryObj of organicQueries) {
      if (allResults.length >= 15) break;
      const results = await fetchQuery(queryObj);
      addResults(results);
      await new Promise((res) => setTimeout(res, 500));
    }
  }

  // ── Phase 3: Scrape engagement directly from URLs (fills in N/A gaps) ──
  // Run in batches of 3 to avoid hammering platforms.
  // Wrapped in try/catch — a scrape failure must NEVER crash the bot.
  try {
    const needsEngagement = allResults.filter((r) => !r.engagement);
    const CONCURRENCY = 3;
    for (let i = 0; i < needsEngagement.length; i += CONCURRENCY) {
      const batch = needsEngagement.slice(i, i + CONCURRENCY);
      const scraped = await Promise.all(batch.map((r) => scrapeEngagement(r.link)));
      scraped.forEach((eng, idx) => {
        if (eng) batch[idx].engagement = eng;
      });
      if (i + CONCURRENCY < needsEngagement.length) {
        await new Promise((res) => setTimeout(res, 600));
      }
    }
  } catch (err) {
    console.warn('Engagement scrape phase failed (non-fatal):', err.message);
  }


  // Sort: results with real engagement data first
  allResults.sort((a, b) => (b.engagement ? 1 : 0) - (a.engagement ? 1 : 0));

  return allResults.slice(0, 10);
}

module.exports = { searchContent };
