import { PlaywrightCrawler, HttpCrawler } from 'crawlee';
import { log } from 'apify';
function parseCount(text) {
    if (!text)
        return 0;
    const clean = text.replace(/,/g, '').trim();
    const match = clean.match(/([\d.]+)\s*([KkMmBb]?)/);
    if (!match)
        return 0;
    const num = parseFloat(match[1]);
    const suffix = match[2].toUpperCase();
    if (suffix === 'K')
        return Math.floor(num * 1000);
    if (suffix === 'M')
        return Math.floor(num * 1_000_000);
    if (suffix === 'B')
        return Math.floor(num * 1_000_000_000);
    return Math.floor(num);
}
function normalizeDate(d) {
    return d
        .replace(/(\d+)d ago/i, '$1 days ago')
        .replace(/(\d+)h ago/i, '$1 hours ago')
        .replace(/(\d+)w ago/i, '$1 weeks ago')
        .replace(/(\d+)mo? ago/i, '$1 months ago')
        .replace(/(\d+)y ago/i, '$1 years ago');
}
/** Extract all video cards from the current page DOM */
async function extractVideoCards(page) {
    return page.evaluate(() => {
        const results = [];
        const items = document.querySelectorAll('ytd-rich-item-renderer');
        for (const item of items) {
            const anchor = item.querySelector('a[href*="/watch?v="], a[href*="/shorts/"]');
            if (!anchor)
                continue;
            const href = anchor.getAttribute('href') || '';
            const watchMatch = href.match(/\/watch\?v=([^&]+)/);
            const shortsMatch = href.match(/\/shorts\/([^?]+)/);
            const videoId = (watchMatch?.[1] || shortsMatch?.[1] || '').trim();
            if (!videoId)
                continue;
            const h3 = item.querySelector('h3[title], h3.ytLockupMetadataViewModelHeadingReset');
            const title = (h3?.getAttribute('title') || h3?.textContent || '').trim();
            const metaSpans = Array.from(item.querySelectorAll('span.ytContentMetadataViewModelMetadataText'));
            const viewsText = (metaSpans[0]?.textContent || '').trim();
            const dateText = (metaSpans[1]?.textContent || '').trim();
            const durationEl = item.querySelector('.ytBadgeShapeText');
            const durationText = (durationEl?.textContent || '').trim();
            const img = item.querySelector('img.ytCoreImageHost');
            const thumbnailUrl = img?.src || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
            results.push({ videoId, title, viewsText, dateText, durationText, thumbnailUrl });
        }
        return results;
    });
}
/**
 * Phase 2: Fetch like counts for a batch of videos using lightweight HttpCrawler.
 * Parses ytInitialData from watch page HTML — same strategy as before but now only
 * for this specific purpose, keeping Playwright browser free.
 */
async function fetchLikesForVideos(videos, options, pushData) {
    const videosById = new Map(videos.map(v => [v.videoId, v]));
    const httpCrawler = new HttpCrawler({
        maxConcurrency: 20, // Fast parallel HTTP requests
        requestHandlerTimeoutSecs: 30,
        async requestHandler({ request, body }) {
            const videoId = request.userData.videoId;
            const videoData = videosById.get(videoId);
            if (!videoData)
                return;
            const html = body.toString();
            // Extract like count from ytInitialData
            let likeCount = 0;
            const match = html.match(/var ytInitialData = (\{.*?\});<\/script>/);
            if (match?.[1]) {
                try {
                    const data = JSON.parse(match[1]);
                    const findLikes = (obj) => {
                        if (!obj || typeof obj !== 'object')
                            return '';
                        if (Array.isArray(obj)) {
                            for (const item of obj) {
                                const r = findLikes(item);
                                if (r)
                                    return r;
                            }
                            return '';
                        }
                        if (obj.segmentedLikeDislikeButtonViewModel) {
                            const btn = obj.segmentedLikeDislikeButtonViewModel
                                ?.likeButtonViewModel?.likeButtonViewModel
                                ?.toggleButtonViewModel?.toggleButtonViewModel
                                ?.defaultButtonViewModel?.buttonViewModel;
                            if (btn?.title)
                                return btn.title;
                        }
                        for (const key of Object.keys(obj)) {
                            const r = findLikes(obj[key]);
                            if (r)
                                return r;
                        }
                        return '';
                    };
                    likeCount = parseCount(findLikes(data.contents));
                }
                catch (_) { /* ignore parse errors */ }
            }
            videoData.likeCount = likeCount;
            if (options.minLikes && likeCount < options.minLikes) {
                log.info(`Skipped ${videoId} — ${likeCount} likes < min ${options.minLikes}`);
                return;
            }
            await pushData(videoData);
            log.info(`✓ ${videoData.title} — ${likeCount.toLocaleString()} likes`);
        },
    });
    await httpCrawler.run(videos.map(v => ({
        url: `https://www.youtube.com/watch?v=${v.videoId}`,
        userData: { videoId: v.videoId },
    })));
}
export class YouTubeScraper {
    async init() { }
    async getChannelId(url) { return url; }
    async scrapeChannel(channelId, channelUrl, options, pushData) {
        const tabs = [];
        if (options.videoType === 'ALL' || options.videoType === 'LONG_FORM') {
            tabs.push({ url: `${channelUrl}/videos`, type: 'LONG_FORM_TAB' });
        }
        if (options.videoType === 'ALL' || options.videoType === 'SHORTS') {
            tabs.push({ url: `${channelUrl}/shorts`, type: 'SHORTS_TAB' });
        }
        const maxItems = options.maxItemsPerChannel && options.maxItemsPerChannel > 0
            ? options.maxItemsPerChannel
            : Infinity;
        // Collect all videos first (Phase 1), then fetch likes (Phase 2)
        const collectedVideos = [];
        let totalPushed = 0;
        // ── PHASE 1: Playwright scroll + DOM extract ──────────────────────
        const playwrightCrawler = new PlaywrightCrawler({
            maxConcurrency: 2, // Low concurrency: each tab uses ~200MB browser memory
            requestHandlerTimeoutSecs: 300,
            headless: true,
            launchContext: {
                launchOptions: {
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-gpu',
                        '--disable-extensions',
                        '--disable-background-networking',
                        '--disable-sync',
                        '--disable-translate',
                        '--mute-audio',
                        '--no-first-run',
                        '--safebrowsing-disable-auto-update',
                        '--disable-blink-features=AutomationControlled',
                    ],
                },
            },
            preNavigationHooks: [
                async ({ page }) => {
                    // Block heavy resources not needed for scraping
                    await page.route('**/*.{mp4,webm,mp3,woff,woff2,ttf,png,svg}', r => r.abort());
                    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
                    await page.addInitScript(() => {
                        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                    });
                },
            ],
            async requestHandler({ request, page }) {
                const type = request.userData.type;
                const videoType = type === 'LONG_FORM_TAB' ? 'LONG_FORM' : 'SHORTS';
                // Get channel name
                let channelName = 'Unknown Channel';
                try {
                    await page.waitForSelector('yt-page-header-view-model, #channel-header-container', { timeout: 15000 });
                    channelName = await page.evaluate(() => {
                        return (document.querySelector('yt-page-header-view-model h1 span')?.textContent?.trim() ||
                            document.querySelector('#channel-header-container #text')?.textContent?.trim() ||
                            'Unknown Channel');
                    });
                }
                catch (_) { /* fine */ }
                log.info(`Scraping [${type}] for: ${channelName}`);
                // Wait for first video to appear
                await page.waitForSelector('ytd-rich-item-renderer', { timeout: 30000 });
                // Scroll until maxItems reached or no new items appear
                const SCROLL_PAUSE = 1500;
                const MAX_STALE = 5;
                let lastCount = 0;
                let staleScrolls = 0;
                while (staleScrolls < MAX_STALE) {
                    const current = await page.$$eval('ytd-rich-item-renderer', els => els.length);
                    lastCount = current;
                    if (current >= maxItems) {
                        log.info(`[${channelName}] Target reached (${current} items). Stopping scroll.`);
                        break;
                    }
                    if (current === lastCount) {
                        staleScrolls++;
                    }
                    else {
                        staleScrolls = 0;
                        log.info(`[${channelName}] Loaded ${current} items...`);
                    }
                    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 5));
                    await page.waitForTimeout(SCROLL_PAUSE);
                }
                log.info(`[${channelName}] Scroll done — ${lastCount} DOM items loaded`);
                // Extract video cards
                const cards = await extractVideoCards(page);
                log.info(`[${channelName}] Extracted ${cards.length} cards`);
                for (const card of cards) {
                    if (totalPushed >= maxItems)
                        break;
                    const viewCount = parseCount(card.viewsText);
                    if (options.minViews && viewCount < options.minViews)
                        continue;
                    const videoData = {
                        channelName,
                        channelUrl,
                        videoId: card.videoId,
                        videoUrl: `https://www.youtube.com/watch?v=${card.videoId}`,
                        title: card.title,
                        type: videoType,
                        uploadDateText: normalizeDate(card.dateText),
                        viewCount,
                        durationText: card.durationText,
                        thumbnailUrl: card.thumbnailUrl,
                        animatedThumbnailUrl: `https://i.ytimg.com/an_webp/${card.videoId}/mqdefault_6s.webp`,
                    };
                    collectedVideos.push(videoData);
                    totalPushed++;
                }
                log.info(`[${channelName}] ${type} complete — ${totalPushed} videos collected`);
            },
        });
        await playwrightCrawler.run(tabs.map(t => ({ url: t.url, userData: { type: t.type } })));
        log.info(`Phase 1 complete. Collected ${collectedVideos.length} videos.`);
        // ── PHASE 2: Fetch likes via fast HttpCrawler ──────────────────────
        if (options.fetchLikes && collectedVideos.length > 0) {
            log.info(`Phase 2: Fetching likes for ${collectedVideos.length} videos via HttpCrawler...`);
            await fetchLikesForVideos(collectedVideos, options, pushData);
        }
        else {
            // No likes needed — push all directly
            for (const video of collectedVideos) {
                await pushData(video);
            }
        }
        log.info(`Finished scraping ${channelUrl}. Total items pushed: ${collectedVideos.length}`);
    }
}
