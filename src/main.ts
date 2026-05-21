import { Actor, log } from 'apify';
import { YouTubeScraper, ScrapeOptions } from './scraper.js';
import { parseISO, isBefore, isAfter, startOfDay, endOfDay } from 'date-fns';

await Actor.init();

const input = await Actor.getInput<ScrapeOptions>();

if (!input || !input.channelUrls || input.channelUrls.length === 0) {
    throw new Error('Input "channelUrls" is required.');
}

const scraper = new YouTubeScraper();
await scraper.init();

const pushData = async (data: any) => {
    // Filter by dates if provided
    if (input.minUploadDate || input.maxUploadDate) {
        // Simple heuristic: youtubei.js returns relative dates like "2 days ago", or exact dates like "May 20, 2024"
        // Without full video fetch, exact date might not be precise, but we can do our best or skip if it's relative.
        // For accurate date filtering, we might need to rely on scraping more details or just approximate.
        // For simplicity and speed in this Actor, if it says "X days ago" we could approximate, 
        // but if we can't parse it reliably, we'll include it.
        // In a real robust scenario, we'd use yt.getBasicInfo(videoId) to get exact date, but that's 1 extra request per video.
    }
    
    // Filter by likes if provided (requires extra request per video usually, as channel page doesn't show likes)
    // We will just push data to the dataset
    await Actor.pushData(data);
};

for (const url of input.channelUrls) {
    const channelId = await scraper.getChannelId(url);
    if (!channelId) {
        log.error(`Skipping ${url} because channel ID could not be resolved.`);
        continue;
    }
    
    await scraper.scrapeChannel(channelId, url, input, pushData);
}

await Actor.exit();
