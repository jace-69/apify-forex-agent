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

// 2. FETCH NEWS
// We filter strictly for Google News Finance results
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

// 3. AI ANALYSIS
if (feed && feed.items.length > 0) {
    console.log('🧠 Sending context to Gemini AI...');
    
    // Create a summarized context string
    const headlines = feed.items.slice(0, 15).map((item, i) => `${i + 1}. ${item.title}`).join('\n');
    
    const genAI = new GoogleGenerativeAI(input!.geminiApiKey);
    
    // *** FIX: USING GEMINI 1.5 FLASH ***
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
    Act as a senior Forex Analyst.
    Analyze the sentiment for ${PAIR} based on these headlines:
    ---
    ${headlines}
    ---
    Return raw JSON with no markdown blocks:
    {
        "sentiment_score": (Number -10 to 10),
        "outlook": (String "Bullish"/"Bearish"),
        "reason": (String concise summary)
    }
    `;

    try {
        const result = await model.generateContent(prompt);
        // Clean markdown backticks just in case
        const text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        const analysis = JSON.parse(text);

        await Actor.pushData({
            timestamp: new Date().toISOString(),
            pair: PAIR,
            ...analysis,
            news_volume: feed.items.length
        });
        
        console.log(`🎉 Success! Market Outlook: ${analysis.outlook}`);

    } catch (error: any) {
        console.error('AI Error:', error.message);
        // Fallback: Save the raw news so the user still gets value!
        await Actor.pushData({ 
            error: "AI Analysis failed, but here are the latest headlines.", 
            latest_news: feed.items.slice(0,5).map(i => i.title) 
        });
    }
} else {
    console.log('⚠️ No news found.');
}

await Actor.exit();