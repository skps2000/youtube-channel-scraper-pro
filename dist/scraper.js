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
function isOlderThanDays(dateText, maxDays) {
    const text = dateText.toLowerCase();
    const match = text.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?/);
    if (!match)
        return false;
    const value = parseInt(match[1]);
    const unit = match[2];
    let days = 0;
    if (unit === 'day')
        days = value;
    else if (unit === 'week')
        days = value * 7;
    else if (unit === 'month')
        days = value * 30;
    else if (unit === 'year')
        days = value * 365;
    return days > maxDays;
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
function extractVideosFromInitialData(ytInitialData) {
    let videos = [];
    function traverse(obj) {
        if (!obj || typeof obj !== 'object')
            return;
        if (Array.isArray(obj)) {
            for (const item of obj)
                traverse(item);
            return;
        }
        // Old UI format
        if (obj.gridVideoRenderer) {
            videos.push({
                videoId: obj.gridVideoRenderer.videoId,
                title: obj.gridVideoRenderer.title?.runs?.[0]?.text || '',
                viewsText: obj.gridVideoRenderer.viewCountText?.simpleText || '',
                dateText: obj.gridVideoRenderer.publishedTimeText?.simpleText || '',
                durationText: obj.gridVideoRenderer.thumbnailOverlays?.[0]?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText || '',
                thumbnailUrl: obj.gridVideoRenderer.thumbnail?.thumbnails?.[obj.gridVideoRenderer.thumbnail?.thumbnails?.length - 1]?.url || ''
            });
        }
        // New UI format
        if (obj.lockupViewModel && obj.lockupViewModel.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
            const vm = obj.lockupViewModel;
            const metadataRows = vm.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows || [];
            let viewsText = '';
            let dateText = '';
            if (metadataRows.length > 0 && metadataRows[0].metadataParts) {
                viewsText = metadataRows[0].metadataParts[0]?.text?.content || '';
                dateText = metadataRows[0].metadataParts[1]?.text?.content || '';
            }
            const badges = vm.contentImage?.thumbnailViewModel?.overlays?.[0]?.thumbnailBottomOverlayViewModel?.badges || [];
            const durationText = badges[0]?.thumbnailBadgeViewModel?.text || '';
            const sources = vm.contentImage?.thumbnailViewModel?.image?.sources || [];
            const thumbnailUrl = sources.length > 0 ? sources[sources.length - 1].url : '';
            videos.push({
                videoId: vm.contentId,
                title: vm.metadata?.lockupMetadataViewModel?.title?.content || '',
                viewsText,
                dateText,
                durationText,
                thumbnailUrl
            });
        }
        for (const key of Object.keys(obj)) {
            traverse(obj[key]);
        }
    }
    traverse(ytInitialData);
    // Deduplicate by videoId
    const uniqueVideos = [];
    const seenIds = new Set();
    for (const v of videos) {
        if (!seenIds.has(v.videoId)) {
            seenIds.add(v.videoId);
            uniqueVideos.push(v);
        }
    }
    return uniqueVideos;
}
/**
 * Fetch like counts using lightweight HttpCrawler.
 */
async function fetchLikesForVideos(videos, options, pushData) {
    const videosById = new Map(videos.map(v => [v.videoId, v]));
    const httpCrawler = new HttpCrawler({
        maxConcurrency: 50, // Fast parallel HTTP requests
        requestHandlerTimeoutSecs: 30,
        async requestHandler({ request, body }) {
            const videoId = request.userData.videoId;
            const videoData = videosById.get(videoId);
            if (!videoData)
                return;
            const html = body.toString();
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
                catch (_) { /* ignore */ }
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
    async scrapeChannels(channelUrls, options, pushData) {
        const tabs = [];
        for (const channelUrl of channelUrls) {
            if (options.videoType === 'ALL' || options.videoType === 'LONG_FORM') {
                tabs.push({ url: `${channelUrl}/videos`, type: 'LONG_FORM_TAB', channelUrl });
            }
            if (options.videoType === 'ALL' || options.videoType === 'SHORTS') {
                tabs.push({ url: `${channelUrl}/shorts`, type: 'SHORTS_TAB', channelUrl });
            }
        }
        const maxItems = options.maxItemsPerChannel && options.maxItemsPerChannel > 0
            ? options.maxItemsPerChannel
            : Infinity;
        const collectedVideos = [];
        const tabsNeedingScroll = [];
        // ── PHASE 1A: FAST-TRACK HTTP CRAWLER ──────────────────────
        log.info(`Phase 1A: Fast-track HTTP extraction for ${tabs.length} tabs...`);
        const fastTrackCrawler = new HttpCrawler({
            maxConcurrency: 50,
            requestHandlerTimeoutSecs: 30,
            async requestHandler({ request, body }) {
                const { type, channelUrl } = request.userData;
                const videoType = type === 'LONG_FORM_TAB' ? 'LONG_FORM' : 'SHORTS';
                const html = body.toString();
                const channelNameMatch = html.match(/<title>(.*?) - YouTube<\/title>/);
                const channelName = channelNameMatch ? channelNameMatch[1].replace(' - YouTube', '') : 'Unknown Channel';
                const initialDataMatch = html.match(/var ytInitialData = (\{.*?\});<\/script>/);
                if (initialDataMatch?.[1]) {
                    try {
                        const data = JSON.parse(initialDataMatch[1]);
                        const videos = extractVideosFromInitialData(data);
                        log.info(`[${channelName}] Fast-track found ${videos.length} videos`);
                        let pushed = 0;
                        let hitDateLimit = false;
                        for (const card of videos) {
                            if (pushed >= maxItems)
                                break;
                            const viewCount = parseCount(card.viewsText);
                            if (options.minViews && viewCount < options.minViews)
                                continue;
                            const normalizedDate = normalizeDate(card.dateText);
                            if (options.maxDaysOld && options.maxDaysOld > 0 && isOlderThanDays(normalizedDate, options.maxDaysOld)) {
                                log.info(`[${channelName}] Video is older than ${options.maxDaysOld} days (${normalizedDate}). Stopping.`);
                                hitDateLimit = true;
                                break;
                            }
                            collectedVideos.push({
                                channelName,
                                channelUrl,
                                videoId: card.videoId,
                                videoUrl: `https://www.youtube.com/watch?v=${card.videoId}`,
                                title: card.title,
                                type: videoType,
                                uploadDateText: normalizedDate,
                                viewCount,
                                durationText: card.durationText,
                                thumbnailUrl: card.thumbnailUrl || `https://i.ytimg.com/vi/${card.videoId}/hqdefault.jpg`,
                                animatedThumbnailUrl: `https://i.ytimg.com/an_webp/${card.videoId}/mqdefault_6s.webp`,
                            });
                            pushed++;
                        }
                        if (!hitDateLimit && videos.length < maxItems && videos.length >= 20) {
                            log.info(`[${channelName}] Requires more than ${videos.length} items. Queuing for deep scroll...`);
                            tabsNeedingScroll.push(request.userData);
                        }
                        else {
                            log.info(`[${channelName}] Fast-track complete (${pushed} videos). No deep scroll needed.`);
                        }
                    }
                    catch (e) {
                        log.error(`Failed to parse ytInitialData for ${request.url}: ${e.message}`);
                        tabsNeedingScroll.push(request.userData);
                    }
                }
                else {
                    tabsNeedingScroll.push(request.userData);
                }
            }
        });
        await fastTrackCrawler.run(tabs.map(t => ({ url: t.url, userData: { ...t, url: t.url } })));
        // ── PHASE 1B: DEEP SCROLL PLAYWRIGHT (Fallback) ──────────────────────
        if (tabsNeedingScroll.length > 0) {
            log.info(`Phase 1B: Deep scrolling required for ${tabsNeedingScroll.length} tabs...`);
            // Remove videos already collected for these tabs so we don't duplicate
            // We will just recount and collect from scratch for these specific tabs to avoid complex merging.
            for (let i = collectedVideos.length - 1; i >= 0; i--) {
                const v = collectedVideos[i];
                if (tabsNeedingScroll.some(t => t.channelUrl === v.channelUrl &&
                    ((t.type === 'LONG_FORM_TAB' && v.type === 'LONG_FORM') || (t.type === 'SHORTS_TAB' && v.type === 'SHORTS')))) {
                    collectedVideos.splice(i, 1);
                }
            }
            const playwrightCrawler = new PlaywrightCrawler({
                maxConcurrency: 5, // Increased concurrency
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
                        await page.route('**/*.{mp4,webm,mp3,woff,woff2,ttf,png,svg}', r => r.abort());
                        await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
                        await page.addInitScript(() => {
                            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                        });
                    },
                ],
                async requestHandler({ request, page }) {
                    const type = request.userData.type;
                    const channelUrl = request.userData.channelUrl;
                    const videoType = type === 'LONG_FORM_TAB' ? 'LONG_FORM' : 'SHORTS';
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
                    await page.waitForSelector('ytd-rich-item-renderer', { timeout: 30000 });
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
                    const cards = await extractVideoCards(page);
                    log.info(`[${channelName}] Extracted ${cards.length} cards`);
                    let pushed = 0;
                    for (const card of cards) {
                        if (pushed >= maxItems)
                            break;
                        const viewCount = parseCount(card.viewsText);
                        if (options.minViews && viewCount < options.minViews)
                            continue;
                        const normalizedDate = normalizeDate(card.dateText);
                        if (options.maxDaysOld && options.maxDaysOld > 0 && isOlderThanDays(normalizedDate, options.maxDaysOld)) {
                            log.info(`[${channelName}] Video is older than ${options.maxDaysOld} days (${normalizedDate}). Stopping deep scroll extraction.`);
                            break;
                        }
                        collectedVideos.push({
                            channelName,
                            channelUrl,
                            videoId: card.videoId,
                            videoUrl: `https://www.youtube.com/watch?v=${card.videoId}`,
                            title: card.title,
                            type: videoType,
                            uploadDateText: normalizedDate,
                            viewCount,
                            durationText: card.durationText,
                            thumbnailUrl: card.thumbnailUrl,
                            animatedThumbnailUrl: `https://i.ytimg.com/an_webp/${card.videoId}/mqdefault_6s.webp`,
                        });
                        pushed++;
                    }
                    log.info(`[${channelName}] ${type} complete — ${pushed} videos collected`);
                },
            });
            await playwrightCrawler.run(tabsNeedingScroll.map(t => ({ url: t.url, userData: t })));
        }
        log.info(`Phase 1 complete. Collected ${collectedVideos.length} videos across all channels.`);
        // ── PHASE 2: Fetch likes via fast HttpCrawler ──────────────────────
        if (options.fetchLikes && collectedVideos.length > 0) {
            log.info(`Phase 2: Fetching likes for ${collectedVideos.length} videos via HttpCrawler...`);
            await fetchLikesForVideos(collectedVideos, options, pushData);
        }
        else {
            for (const video of collectedVideos) {
                await pushData(video);
            }
        }
        log.info(`Finished scraping all channels. Total items pushed: ${collectedVideos.length}`);
    }
}
