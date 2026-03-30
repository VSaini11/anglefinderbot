const axios = require('axios');

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

  // Reject low-replicability content
  for (const kw of REJECT_KEYWORDS) {
    if (text.includes(kw)) return null;
  }

  // Match allowed formats
  for (const [format, keywords] of Object.entries(FORMAT_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw)) return format;
    }
  }

  // Default: if it's from a valid platform, assume it could be replicated
  return 'Text-on-Screen';
}

// ─── Parse Engagement ─────────────────────────────────────────────────────────
function parseEngagement(snippet = '') {
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

// ─── Build Search Queries ─────────────────────────────────────────────────────
function buildQueries(angles) {
  const platforms = [
    { site: 'site:tiktok.com', label: 'tiktok' },
    { site: 'site:instagram.com', label: 'instagram' },
    { site: 'site:facebook.com/watch OR site:facebook.com/reel', label: 'facebook' },
  ];

  const queries = [];

  // Use top 4 angles to limit API calls
  const topAngles = angles.slice(0, 4);

  for (const angle of topAngles) {
    // Pick a platform per angle (rotate)
    const platform = platforms[queries.length % platforms.length];
    queries.push({ query: `${platform.site} "${angle}"`, angle, platform: platform.label });
  }

  // Add a couple of broader queries for coverage
  if (topAngles.length > 0) {
    queries.push({
      query: `site:tiktok.com "${topAngles[0]}" tutorial`,
      angle: topAngles[0],
      platform: 'tiktok',
    });
    queries.push({
      query: `site:instagram.com reels "${topAngles[1] || topAngles[0]}"`,
      angle: topAngles[1] || topAngles[0],
      platform: 'instagram',
    });
  }

  return queries;
}

// ─── Fetch One Query via SerpAPI ──────────────────────────────────────────────
async function fetchQuery(query, angle, retries = 2, delay = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(SERP_API_URL, {
        params: {
          q: query,
          api_key: process.env.SERP_API_KEY,
          num: 5,
          hl: 'en',
          gl: 'us',
        },
        timeout: 15000,
      });

      const organicResults = response.data?.organic_results || [];

      return organicResults
        .map((r) => {
          const link = r.link || '';
          const title = r.title || '';
          const snippet = r.snippet || '';
          const platform = detectPlatform(link);

          if (platform === 'Unknown') return null;

          const format = detectFormat(title, snippet);
          if (!format) return null; // Rejected by heuristics

          return {
            link,
            platform,
            engagement: parseEngagement(snippet),
            format,
            angle,
          };
        })
        .filter(Boolean);
    } catch (err) {
      if (attempt === retries) {
        console.error(`SerpAPI error for query "${query}":`, err.message);
        return [];
      }
      await new Promise((res) => setTimeout(res, delay * attempt));
    }
  }
  return [];
}

// ─── Main Search Orchestrator ─────────────────────────────────────────────────
async function searchContent(angles) {
  const queries = buildQueries(angles);
  const allResults = [];
  const seenLinks = new Set();

  // Run queries sequentially to respect rate limits
  for (const { query, angle } of queries) {
    if (allResults.length >= 15) break; // Stop early if we have enough

    const results = await fetchQuery(query, angle);

    for (const result of results) {
      if (!seenLinks.has(result.link)) {
        seenLinks.add(result.link);
        allResults.push(result);
      }
    }

    // Small delay between requests
    await new Promise((res) => setTimeout(res, 500));
  }

  // Sort: prefer results with engagement data
  allResults.sort((a, b) => (b.engagement ? 1 : 0) - (a.engagement ? 1 : 0));

  return allResults.slice(0, 10);
}

module.exports = { searchContent };
