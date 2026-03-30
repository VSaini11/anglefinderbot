# 🤖 Content Discovery Bot

A production-ready Telegram bot that analyzes any website URL and returns **10 high-performing, replicable content pieces** from TikTok, Instagram, and Facebook — filtered for formats you can recreate with minimal editing.

---

## 📁 Project Structure

```
content-discovery-bot/
├── bot.js          # Telegram bot — entry point, message handling
├── scraper.js      # Axios + Cheerio website scraper
├── ai.js           # Gemini angle extraction
├── search.js       # SerpAPI content discovery + filtering
├── .env.example    # Environment variable template
├── package.json
├── railway.toml    # Railway deployment config
└── README.md
```

---

## ⚙️ How It Works

1. **User sends a URL** → bot validates it
2. **Scraper** extracts headings, paragraphs, meta tags from the site
3. **Gemini** extracts 5–8 marketing angles (e.g. "Save time", "Fear of missing out")
4. **SerpAPI** searches TikTok, Instagram, Facebook using those angles as search terms
5. **Filtering logic** keeps only: slideshow, text-on-screen, meme, animation, screen recording
6. **Bot returns** top 10 results with platform, engagement, format, and angle used

---

## 🚀 Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/your-username/content-discovery-bot.git
cd content-discovery-bot
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

```bash
cp .env.example .env
```

Edit `.env` with your actual keys:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
GEMINI_API_KEY=your_gemini_api_key_here
SERP_API_KEY=your_serpapi_key_here
```

### 4. Run the bot

```bash
npm start
```

For development with auto-restart:
```bash
npm run dev
```

---

## 🔑 Getting API Keys

### Telegram Bot Token
1. Open Telegram and search for **@BotFather**
2. Send `/newbot` and follow prompts
3. Copy the token provided

### Gemini API Key
1. Go to [https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. Create a new API key (free tier available)
3. Uses `gemini-1.5-flash` — fast and cost-effective

### SerpAPI Key
1. Sign up at [https://serpapi.com](https://serpapi.com)
2. Free tier: 100 searches/month
3. Copy your API key from the dashboard

---

## 📦 Dependencies

| Package | Purpose |
|---|---|
| `node-telegram-bot-api` | Telegram bot interface |
| `axios` | HTTP requests (scraping) |
| `cheerio` | HTML parsing |
| `dotenv` | Environment variable management |
| `@google/generative-ai` | Google Gemini AI SDK |

---

## 🚢 Deploy on Railway

1. Push your code to GitHub (make sure `.env` is in `.gitignore`)
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Select your repo
4. In **Variables**, add all three env vars:
   - `TELEGRAM_BOT_TOKEN`
   - `GEMINI_API_KEY`
   - `SERP_API_KEY`
5. Railway auto-detects Node.js and runs `node bot.js`

The `railway.toml` is already configured for you.

---

## 🎬 Content Filtering Logic

**Allowed formats** (detectable via keyword heuristics):
- Slideshow / Carousel
- Text-on-Screen
- Meme
- Animation / Motion Graphic
- Screen Recording / Tutorial

**Rejected formats:**
- Talking face / vlog
- Cinematic / high-production
- Watermark-heavy content
- Studio/film content

---

## 💬 Bot Commands

| Command | Description |
|---|---|
| `/start` | Welcome message + instructions |
| (any URL) | Analyze the URL and return 10 results |

---

## ⚠️ Error Handling

| Scenario | Response |
|---|---|
| Invalid URL | Prompts user to send a valid URL |
| Site can't be scraped | Clear error message |
| No angles extracted | Error + retry suggestion |
| No results found | "No replicable content found. Try another URL." |
| API failure | Shows specific error, retries automatically |

---

## 📊 API Usage Estimates

Per analysis (one URL):
- **Gemini**: ~1 request (free tier: 15 requests/min, 1M tokens/day)
- **SerpAPI**: ~6 requests → uses 6 of your monthly quota
- **Scraper**: Free (direct HTTP)

---

## 🛠️ Customization

- **Change Gemini model**: Edit `model` in `ai.js` (default: `gemini-1.5-flash`, alternatives: `gemini-1.5-pro`)
- **Add more platforms**: Extend `platforms` array in `search.js`
- **Adjust filtering**: Edit `FORMAT_KEYWORDS` and `REJECT_KEYWORDS` in `search.js`
- **Change result count**: Edit `.slice(0, 10)` in `bot.js` and `search.js`

---

## 📄 License

MIT
