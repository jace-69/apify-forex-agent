import { Actor } from 'apify';
import Parser from 'rss-parser';
import { GoogleGenerativeAI } from '@google/generative-ai';

interface Input {
    forexPair: string;
    geminiApiKey: string;
    hoursLookback?: number;
}

await Actor.init();

// 1. SETUP & VALIDATION
const input = await Actor.getInput<Input>();
if (!input?.geminiApiKey) {
    await Actor.fail('❌ Configuration Error: Gemini API Key is missing.');
}

const PAIR = (input?.forexPair || 'XAUUSD').toUpperCase();
const HOURS = input?.hoursLookback || 24;

console.log(`🚀 AI Agent analyzing sentiment for: ${PAIR} (Last ${HOURS}h)`);

// 2. FETCH NEWS (via RSS to bypass blockers)
const rssUrl = `https://news.google.com/rss/search?q=${PAIR}+when:${HOURS}h&hl=en-US&gl=US&ceid=US:en`;
const parser = new Parser();
let feed;

try {
    feed = await parser.parseURL(rssUrl);
    console.log(`✅ Collected ${feed.items.length} news articles.`);
} catch (e) {
    console.error('RSS Error:', e);
    await Actor.fail('Failed to fetch news feed.');
}

// 3. AI ANALYSIS (Gemini 1.5 Flash)
if (feed && feed.items.length > 0) {
    console.log('🧠 Sending context to Gemini AI...');
    
    // Create a summarized context for the LLM
    const headlines = feed.items.slice(0, 20).map((item, i) => `${i + 1}. ${item.title}`).join('\n');
    
    const genAI = new GoogleGenerativeAI(input!.geminiApiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
    Role: Professional Forex Analyst.
    Task: Analyze the market sentiment for ${PAIR} based on these headlines:
    ---
    ${headlines}
    ---
    Output Requirements: 
    Return strictly raw JSON (no markdown formatting).
    JSON Keys:
    - sentiment_score: Number (-10 to 10)
    - trend: String ("Bullish", "Bearish", "Neutral")
    - key_driver: String (Main reason)
    - summary: String (Concise analysis)
    `;

    try {
        const result = await model.generateContent(prompt);
        // Clean markdown backticks if AI adds them
        const text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        const analysis = JSON.parse(text);

        // 4. OUTPUT TO DATASET (The winning payload)
        await Actor.pushData({
            timestamp: new Date().toISOString(),
            pair: PAIR,
            ...analysis,
            source_count: feed.items.length,
            top_articles: feed.items.slice(0, 3).map(i => i.title)
        });
        
        console.log(`🎉 Success! Sentiment: ${analysis.trend} (${analysis.sentiment_score}/10)`);

    } catch (error) {
        console.error('AI Error:', error);
        await Actor.pushData({ error: 'AI processing failed', raw_headlines: headlines });
    }
} else {
    console.log('⚠️ No news found for this timeframe.');
}

await Actor.exit();