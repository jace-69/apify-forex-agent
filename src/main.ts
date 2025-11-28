import { Actor } from 'apify';
import Parser from 'rss-parser';
import { GoogleGenerativeAI } from '@google/generative-ai';

await Actor.init();

// 1. SETUP
const input = await Actor.getInput();
const API_KEY = input?.geminiApiKey;
const PAIR = (input?.forexPair || 'XAUUSD').toUpperCase();
const HOURS = input?.hoursLookback || 24;

if (!API_KEY) {
    await Actor.fail('❌ Configuration Error: Gemini API Key is missing.');
}

console.log(`🚀 Analysis starting for: ${PAIR}`);

// 2. RSS NEWS
const rssUrl = `https://news.google.com/rss/search?q=${PAIR}+when:${HOURS}h&hl=en-US&gl=US&ceid=US:en`;
const parser = new Parser();
let feedItems = [];

try {
    const feed = await parser.parseURL(rssUrl);
    feedItems = feed.items.slice(0, 20); // Take top 20
    console.log(`✅ Collected ${feed.items.length} news articles.`);
} catch (e) {
    console.log(`⚠️ RSS Fetch failed: ${e.message}`);
}

// 3. AI ANALYSIS (WITH RETRY STRATEGY)
if (feedItems.length > 0) {
    const genAI = new GoogleGenerativeAI(API_KEY);
    
    // Create prompt
    const context = feedItems.map((item, i) => `${i + 1}. ${item.title}`).join('\n');
    const prompt = `Analyze Sentiment for ${PAIR}. Headlines:\n${context}\nReturn JSON: { "score": number (-10 to 10), "outlook": string, "summary": string }`;

    let finalData = null;

    // TRY LIST OF MODELS IN ORDER
    const modelsToTry = ["gemini-1.5-flash-001", "gemini-1.5-flash", "gemini-pro"];
    
    for (const modelName of modelsToTry) {
        try {
            console.log(`Trying AI Model: ${modelName}...`);
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent(prompt);
            const text = result.response.text().replace(/```json|```/g, '').trim();
            finalData = JSON.parse(text);
            finalData.model_used = modelName;
            break; // Stop loop if successful
        } catch (error) {
            console.log(`⚠️ Model ${modelName} failed: ${error.message.split(']')[0]}]`);
            // Continue to next model
        }
    }

    if (finalData) {
        console.log(`🎉 Success using ${finalData.model_used}! Sentiment: ${finalData.outlook}`);
        await Actor.pushData({
            pair: PAIR,
            timestamp: new Date().toISOString(),
            ...finalData,
            news: feedItems.map(x => x.title).slice(0, 5)
        });
    } else {
        // FAIL GRACEFULLY - Output news only
        console.log("❌ All AI models failed. Saving raw news data only.");
        await Actor.pushData({
            pair: PAIR,
            error: "AI_GENERATION_FAILED",
            message: "Check API Key permissions or quota.",
            news_headlines: feedItems.map(x => x.title)
        });
    }
} else {
    console.log('⚠️ No news found to analyze.');
}

await Actor.exit();