import { Actor } from 'apify';
import Parser from 'rss-parser';
import { GoogleGenerativeAI } from '@google/generative-ai';

interface Input {
    forexPair: string;
    geminiApiKey: string;
    hoursLookback?: number;
}

await Actor.init();

// 1. INPUT HANDLING
const input = await Actor.getInput<Input>();
if (!input?.geminiApiKey) { 
    await Actor.fail('❌ Error: Missing Gemini API Key in input.'); 
}

const PAIR = (input?.forexPair || 'XAUUSD').toUpperCase();
const HOURS = input?.hoursLookback || 24;

console.log(`🚀 Starting Analysis for ${PAIR} (Last ${HOURS} hours)...`);

// 2. RSS NEWS FETCHING
const rssUrl = `https://news.google.com/rss/search?q=${PAIR}+when:${HOURS}h&hl=en-US&gl=US&ceid=US:en`;
const parser = new Parser();

try {
    const feed = await parser.parseURL(rssUrl);
    
    if (!feed.items || feed.items.length === 0) {
        console.log('⚠️ No news found for this timeframe.');
        await Actor.pushData({ message: "No news found", pair: PAIR });
    } else {
        console.log(`✅ Found ${feed.items.length} news items. Sending to AI...`);

        // 3. PREPARE AI PROMPT
        const genAI = new GoogleGenerativeAI(input!.geminiApiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        // Context: Top 15 headlines
        const headlines = feed.items.slice(0, 15)
            .map((item, index) => `${index + 1}. ${item.title}`)
            .join('\n');

        const prompt = `
            Act as a Senior Forex Analyst. Analyze the sentiment for: ${PAIR}.
            
            Headlines:
            ${headlines}
            
            Strictly Output a JSON object (NO Markdown, NO \`\`\`json tags) with this structure:
            {
                "sentiment_score": (number -10 to 10),
                "trend_outlook": "Bullish/Bearish/Neutral",
                "summary": "One sentence summary of drivers"
            }
        `;

        // 4. CALL AI & CLEAN OUTPUT
        const result = await model.generateContent(prompt);
        let text = result.response.text();
        
        // Remove markdown formatting if Gemini adds it
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        
        const aiData = JSON.parse(text);

        // 5. SAVE RESULT
        await Actor.pushData({
            timestamp: new Date().toISOString(),
            pair: PAIR,
            ...aiData,
            news_source_count: feed.items.length,
            top_headlines: feed.items.slice(0, 5).map(x => x.title)
        });

        console.log(`🎉 Analysis Success: ${aiData.trend_outlook}`);
    }

} catch (error) {
    console.error('Processing failed:', error);
    // Cast error to 'any' or 'Error' to access message safely
    const errorMessage = error instanceof Error ? error.message : String(error);
    await Actor.fail(`Analysis failed: ${errorMessage}`);
}

await Actor.exit();