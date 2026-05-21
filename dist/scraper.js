import { Innertube, UniversalCache } from 'youtubei.js';
import { log } from 'apify';
function parseViewCount(viewText) {
    if (!viewText)
        return 0;
    const match = viewText.match(/[\d,.]+/);
    if (!match)
        return 0;
    // Sometimes it's like 1.2M views or something, but usually youtubei.js provides raw view_count in another field, or exact string like "1,234 views"
    const numStr = match[0].replace(/,/g, '');
    let mult = 1;
    if (viewText.toLowerCase().includes('k'))
        mult = 1000;
    if (viewText.toLowerCase().includes('m'))
        mult = 1000000;
    if (viewText.toLowerCase().includes('b'))
        mult = 1000000000;
    return Math.floor(parseFloat(numStr) * mult);
}
export class YouTubeScraper {
    yt;
    async init() {
        this.yt = await Innertube.create({ cache: new UniversalCache(false) });
    }
    async getChannelId(url) {
        try {
            const resolved = await this.yt.resolveURL(url);
            if (resolved && resolved.payload && resolved.payload.browseId) {
                return resolved.payload.browseId;
            }
            log.warning(`Could not resolve channel URL: ${url}`);
            return null;
        }
        catch (error) {
            log.error(`Error resolving channel URL ${url}: ${error.message}`);
            return null;
        }
    }
    parseVideoData(video, channelName, channelUrl, type) {
        const title = video.title?.text || video.title || "";
        const videoId = video.id || video.video_id;
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        let viewCount = 0;
        if (typeof video.view_count === 'number') {
            viewCount = video.view_count;
        }
        else if (video.view_count?.text) {
            viewCount = parseViewCount(video.view_count.text);
        }
        else if (video.views) {
            viewCount = parseViewCount(video.views);
        }
        const uploadDateText = video.published?.text || video.published_time_text?.text || "";
        const durationText = video.duration?.text || "";
        return {
            channelName,
            channelUrl,
            videoId,
            videoUrl,
            title,
            type,
            uploadDateText,
            viewCount,
            durationText
        };
    }
    async scrapeChannel(channelId, channelUrl, options, pushData) {
        const channel = await this.yt.getChannel(channelId);
        const channelName = channel.title || "Unknown Channel";
        log.info(`Scraping channel: ${channelName} (${channelId})`);
        let totalPushed = 0;
        const maxItems = options.maxItemsPerChannel || Infinity;
        const maxItemsActive = maxItems > 0;
        const minViews = options.minViews || 0;
        // Scrape Long Form
        if (options.videoType === "ALL" || options.videoType === "LONG_FORM") {
            try {
                let feed = await channel.getVideos();
                let keepGoing = true;
                while (keepGoing && feed.videos.length > 0) {
                    for (const v of feed.videos) {
                        if (maxItemsActive && totalPushed >= maxItems) {
                            keepGoing = false;
                            break;
                        }
                        const data = this.parseVideoData(v, channelName, channelUrl, "LONG_FORM");
                        if (data.viewCount >= minViews) {
                            await pushData(data);
                            totalPushed++;
                        }
                    }
                    if (keepGoing && feed.has_continuation) {
                        feed = await feed.getContinuation();
                    }
                    else {
                        keepGoing = false;
                    }
                }
            }
            catch (error) {
                log.warning(`Could not get long-form videos for ${channelName}: ${error.message}`);
            }
        }
        // Scrape Shorts
        if (options.videoType === "ALL" || options.videoType === "SHORTS") {
            try {
                let feed = await channel.getShorts();
                let keepGoing = true;
                while (keepGoing && feed.videos.length > 0) {
                    for (const v of feed.videos) {
                        if (maxItemsActive && totalPushed >= maxItems) {
                            keepGoing = false;
                            break;
                        }
                        const data = this.parseVideoData(v, channelName, channelUrl, "SHORTS");
                        if (data.viewCount >= minViews) {
                            await pushData(data);
                            totalPushed++;
                        }
                    }
                    if (keepGoing && feed.has_continuation) {
                        feed = await feed.getContinuation();
                    }
                    else {
                        keepGoing = false;
                    }
                }
            }
            catch (error) {
                log.warning(`Could not get shorts for ${channelName}: ${error.message}`);
            }
        }
        log.info(`Finished scraping ${channelName}. Total items: ${totalPushed}`);
    }
}
