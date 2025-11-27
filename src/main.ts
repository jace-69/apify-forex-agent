import { Actor } from 'apify';
import Parser from 'rss-parser';
import { GoogleGenerativeAI } from '@google/generative-ai';

interface Input {
    forexPair: string;
    geminiApiKey: string;
    hoursLookback?: number;
}

await Actor.init();
const input = await Actor.getInput<Input>();
if (!input?.geminiApiKey) { await Actor.fail('❌ Missing Gemini API Key'); }

const PAIR = (input?.forexPair || 'XAUUSD').toUpperCase();
const HOURS = input?.hoursLookback || 24;
console.log(`Starting analysis for ${PAIR}`);

const rssUrl = `https://news.google.com/rss/search?q=${PAIR}+when:${HOURS}h&hl=en-US&gl=US&ceid=US:en`;
const parser = new Parser();
try {
    const feed = await parser.parseURL(rssUrl);
    if (!feed.items.length) { 
        console.log('No news found'); 
        await Actor.exit();
    }
    
    // AI Part
    const genAI = new GoogleGenerativeAI(input!.geminiApiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const context = feed.items.slice(0, 15).map((x, i) => `${i+1}. ${x.title}`).join('\n');
    
    const prompt = `Analyze sentiment for ${PAIR} (-10 to 10) based on:\n${context}\nReturn JSON: { "sentiment_score": number, "trend": string, "summary": string }`;
    
    const result = await model.generateContent(prompt);
    const text = result.response.text().replace(/```json|```/g, '').trim();
    const data = JSON.parse(text);

    await Actor.pushData({ pair: PAIR, ...data, articles: feed.items.slice(0,3).map(x => x.title) });

} catch(e) { await Actor.fail(e.message); }
await Actor.exit();
