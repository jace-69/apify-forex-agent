import { Actor } from 'apify';
import Parser from 'rss-parser';
import { GoogleGenerativeAI } from '@google/generative-ai';

// 1. DEFINE INTERFACES (Stops "Property does not exist" errors)
interface Input {
    forexPair?: string;
    geminiApiKey?: string;
    hoursLookback?: number;
}

interface SentimentResult {
    score: number;
    outlook: string;
    summary: string;
    model_used?: string;
}

await Actor.init();

// 2. SETUP
// We tell TypeScript: "The input follows the Input interface we defined above"
const input = await Actor.getInput<Input>() || {}; 

const API_KEY = input.geminiApiKey;
const PAIR = (input.forexPair || 'XAUUSD').toUpperCase();
const HOURS = input.hoursLookback || 24;

if (!API_KEY) {
    await Actor.fail('❌ Configuration Error: Gemini API Key is missing.');
}

console.log(`🚀 Analysis starting for: ${PAIR}`);

// 3. RSS NEWS
const rssUrl = `https://news.google.com/rss/search?q=${PAIR}+when:${HOURS}h&hl=en-US&gl=US&ceid=US:en`;
const parser = new Parser();

// We tell TypeScript: "This is an array of anything" (Fixes 'never[]' error)
let feedItems: any[] = [];

try {
    const feed = await parser.parseURL(rssUrl);
    // Safety check: ensure feed.items exists
    if (feed.items) {
        feedItems = feed.items.slice(0, 20); 
        console.log(`✅ Collected ${feed.items.length} news articles.`);
    }
} catch (error) {
    // We tell TypeScript: "Treat error as an Object with a message"
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`⚠️ RSS Fetch failed: ${msg}`);
}

// 4. AI ANALYSIS
if (feedItems.length > 0) {
    // Explicit string cast ensures it matches library requirements
    const genAI = new GoogleGenerativeAI(API_KEY as string);
    
    const context = feedItems.map((item, i) => `${i + 1}. ${item.title}`).join('\n');
    const prompt = `Analyze Sentiment for ${PAIR}. Headlines:\n${context}\nReturn JSON: { "score": number (-10 to 10), "outlook": string, "summary": string }`;

    // Explicit type allowing null
    let finalData: SentimentResult | null = null;

    const modelsToTry = ["gemini-1.5-flash-001", "gemini-1.5-flash", "gemini-pro"];
    
    for (const modelName of modelsToTry) {
        try {
            console.log(`Trying AI Model: ${modelName}...`);
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent(prompt);
            const text = result.response.text().replace(/```json|```/g, '').replace(/\*/g, '').trim();
            
            const parsed = JSON.parse(text);
            
            // Map parsed JSON to our clean Interface
            finalData = {
                score: parsed.score || 0,
                outlook: parsed.outlook || "Neutral",
                summary: parsed.summary || "No summary",
                model_used: modelName
            };
            break; 
        } catch (error) {
             console.log(`⚠️ Model ${modelName} failed.`);
        }
    }

    // Only spread data if finalData exists (Fixes spread error)
    if (finalData) {
        console.log(`🎉 Success using ${finalData.model_used}! Sentiment: ${finalData.outlook}`);
        await Actor.pushData({
            pair: PAIR,
            timestamp: new Date().toISOString(),
            ...finalData,
            news: feedItems.map(x => x.title).slice(0, 5)
        });
    } else {
        console.log("❌ All AI models failed. Saving headlines only.");
        await Actor.pushData({
            pair: PAIR,
            error: "AI_GENERATION_FAILED",
            news_headlines: feedItems.map(x => x.title)
        });
    }
} else {
    console.log('⚠️ No news found.');
}

await Actor.exit();