import { PlaywrightCrawler } from 'crawlee';
import { log } from 'apify';

export interface ScrapeOptions {
    channelUrls: string[];
    videoType: "ALL" | "LONG_FORM" | "SHORTS";
    minUploadDate?: string;
    maxUploadDate?: string;
    minViews?: number;
    minLikes?: number;
    fetchLikes?: boolean;
    maxItemsPerChannel?: number;
}

export interface VideoData {
    channelName: string;
    channelUrl: string;
    videoId: string;
    videoUrl: string;
    title: string;
    type: "LONG_FORM" | "SHORTS";
    uploadDateText: string;
    viewCount: number;
    durationText?: string;
    thumbnailUrl?: string;
    animatedThumbnailUrl?: string;
    likeCount?: number;
}

function parseCount(text?: string): number {
    if (!text) return 0;
    const clean = text.replace(/,/g, '').trim();
    const match = clean.match(/([\d.]+)\s*([KkMmBb]?)/);
    if (!match) return 0;
    const num = parseFloat(match[1]);
    const suffix = match[2].toUpperCase();
    if (suffix === 'K') return Math.floor(num * 1000);
    if (suffix === 'M') return Math.floor(num * 1_000_000);
    if (suffix === 'B') return Math.floor(num * 1_000_000_000);
    return Math.floor(num);
}

/** Extract all video cards from the current page state via page.evaluate() */
async function extractVideoCards(page: any): Promise<any[]> {
    return page.evaluate(() => {
        const results: any[] = [];
        const items = document.querySelectorAll('ytd-rich-item-renderer');

        for (const item of items) {
            // videoId and URL from anchor tag
            const anchor = item.querySelector('a[href*="/watch?v="], a[href*="/shorts/"]') as HTMLAnchorElement | null;
            if (!anchor) continue;

            const href = anchor.getAttribute('href') || '';
            const watchMatch = href.match(/\/watch\?v=([^&]+)/);
            const shortsMatch = href.match(/\/shorts\/([^?]+)/);
            const videoId = (watchMatch?.[1] || shortsMatch?.[1] || '').trim();
            if (!videoId) continue;

            // title from h3 title attribute (most reliable)
            const h3 = item.querySelector('h3[title], h3.ytLockupMetadataViewModelHeadingReset') as HTMLElement | null;
            const title = (h3?.getAttribute('title') || h3?.textContent || '').trim();

            // metadata spans: views and date
            const metaSpans = Array.from(item.querySelectorAll('span.ytContentMetadataViewModelMetadataText')) as HTMLElement[];
            const viewsText = (metaSpans[0]?.textContent || '').trim();
            const dateText = (metaSpans[1]?.textContent || '').trim();

            // duration badge
            const durationEl = item.querySelector('.ytBadgeShapeText') as HTMLElement | null;
            const durationText = (durationEl?.textContent || '').trim();

            // thumbnail
            const img = item.querySelector('img.ytCoreImageHost') as HTMLImageElement | null;
            const thumbnailUrl = img?.src || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

            results.push({ videoId, title, viewsText, dateText, durationText, thumbnailUrl });
        }
        return results;
    });
}

export class YouTubeScraper {
    async init() {}
    async getChannelId(url: string): Promise<string | null> { return url; }

    async scrapeChannel(
        channelId: string,
        channelUrl: string,
        options: ScrapeOptions,
        pushData: (data: any) => Promise<void>
    ) {
        const tabs: { url: string; type: string }[] = [];
        if (options.videoType === 'ALL' || options.videoType === 'LONG_FORM') {
            tabs.push({ url: `${channelUrl}/videos`, type: 'LONG_FORM_TAB' });
        }
        if (options.videoType === 'ALL' || options.videoType === 'SHORTS') {
            tabs.push({ url: `${channelUrl}/shorts`, type: 'SHORTS_TAB' });
        }

        const maxItems = options.maxItemsPerChannel && options.maxItemsPerChannel > 0
            ? options.maxItemsPerChannel
            : Infinity;

        let totalPushed = 0;

        const crawler = new PlaywrightCrawler({
            // 1 browser per channel tab — don't overload when fetchLikes opens many pages
            maxConcurrency: options.fetchLikes ? 3 : 5,
            requestHandlerTimeoutSecs: 600,
            headless: true,
            launchContext: {
                launchOptions: {
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-blink-features=AutomationControlled',
                    ],
                },
            },
            // Mimic a real browser to avoid bot-detection
            preNavigationHooks: [
                async ({ page }) => {
                    await page.setExtraHTTPHeaders({
                        'Accept-Language': 'en-US,en;q=0.9',
                    });
                    await page.addInitScript(() => {
                        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                    });
                },
            ],

            async requestHandler({ request, page, crawler: currentCrawler }) {
                const type = request.userData.type as 'LONG_FORM_TAB' | 'SHORTS_TAB' | 'VIDEO_PAGE';

                // ── VIDEO PAGE: fetch likes only ──────────────────────────────
                if (type === 'VIDEO_PAGE') {
                    const videoData = request.userData.videoData as VideoData;
                    log.info(`Fetching likes for: ${videoData.title}`);
                    try {
                        // Wait for like button (new YouTube UI)
                        await page.waitForSelector(
                            'like-button-view-model button, ytd-toggle-button-renderer button',
                            { timeout: 20000 }
                        ).catch(() => null);

                        const likeText: string = await page.evaluate(() => {
                            // New segmented like button
                            const btn = document.querySelector('like-button-view-model button');
                            if (btn) return btn.getAttribute('aria-label') || btn.textContent || '';
                            // Legacy toggle button
                            const legacy = document.querySelector('ytd-toggle-button-renderer button');
                            if (legacy) return legacy.getAttribute('aria-label') || legacy.textContent || '';
                            return '';
                        });

                        videoData.likeCount = parseCount(likeText);
                    } catch (e: any) {
                        log.warning(`Like fetch failed for ${videoData.videoId}: ${e.message}`);
                    }

                    if (options.minLikes && (videoData.likeCount ?? 0) < options.minLikes) return;
                    await pushData(videoData);
                    log.info(`✓ ${videoData.videoId} — ${videoData.likeCount?.toLocaleString()} likes`);
                    return;
                }

                // ── CHANNEL TAB: scroll + extract ────────────────────────────
                const videoType = type === 'LONG_FORM_TAB' ? 'LONG_FORM' : 'SHORTS';

                // Get channel name
                let channelName = 'Unknown Channel';
                try {
                    await page.waitForSelector('yt-page-header-view-model, #channel-header-container', { timeout: 15000 });
                    channelName = await page.evaluate(() => {
                        const el =
                            document.querySelector('yt-page-header-view-model h1 span') ||
                            document.querySelector('#channel-header-container #text') ||
                            document.querySelector('ytd-channel-name #text');
                        return el?.textContent?.trim() || 'Unknown Channel';
                    });
                } catch (_) { /* fine */ }

                log.info(`Scraping [${type}] for channel: ${channelName}`);

                // ── SCROLL LOOP ───────────────────────────────────────────────
                // Wait for at least one video card before starting
                await page.waitForSelector('ytd-rich-item-renderer', { timeout: 30000 });

                let staleScrolls = 0;
                const MAX_STALE = 6;          // stop after 6 scrolls with no new items
                const SCROLL_PAUSE = 1800;    // ms between scrolls
                let lastCount = 0;

                while (staleScrolls < MAX_STALE) {
                    const current = await page.$$eval('ytd-rich-item-renderer', els => els.length);
                    lastCount = current;

                    if (current >= maxItems) {
                        log.info(`[${channelName}] Reached target (${current} items), stopping scroll.`);
                        break;
                    }

                    if (current === lastCount) {
                        staleScrolls++;
                    } else {
                        staleScrolls = 0;
                        log.info(`[${channelName}] Loaded ${current} items...`);
                    }

                    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 4));
                    await page.waitForTimeout(SCROLL_PAUSE);
                }

                log.info(`[${channelName}] Scroll complete — total DOM items: ${lastCount}`);

                // ── EXTRACT ───────────────────────────────────────────────────
                const cards = await extractVideoCards(page);
                log.info(`[${channelName}] Extracted ${cards.length} video cards from DOM`);

                for (const card of cards) {
                    if (totalPushed >= maxItems) break;

                    const viewCount = parseCount(card.viewsText);
                    if (options.minViews && viewCount < options.minViews) continue;

                    // Normalize short dates like "8d ago" → "8 days ago"
                    const normalizeDate = (d: string) =>
                        d.replace(/(\d+)d ago/i, '$1 days ago')
                         .replace(/(\d+)h ago/i, '$1 hours ago')
                         .replace(/(\d+)w ago/i, '$1 weeks ago')
                         .replace(/(\d+)mo? ago/i, '$1 months ago')
                         .replace(/(\d+)y ago/i, '$1 years ago');

                    const videoData: VideoData = {
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

                    if (options.fetchLikes) {
                        await currentCrawler.addRequests([{
                            url: videoData.videoUrl,
                            userData: { type: 'VIDEO_PAGE', videoData },
                        }]);
                    } else {
                        await pushData(videoData);
                    }
                    totalPushed++;
                }

                log.info(`[${channelName}] ${type} done — queued/pushed: ${totalPushed}`);
            },
        });

        await crawler.run(tabs.map(t => ({ url: t.url, userData: { type: t.type } })));
        log.info(`Finished scraping ${channelUrl}. Total items queued/pushed: ${totalPushed}`);
    }
}
