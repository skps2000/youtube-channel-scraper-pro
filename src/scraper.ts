import { HttpCrawler } from 'crawlee';
import { log } from 'apify';

export interface ScrapeOptions {
    channelUrls: string[];
    videoType: "ALL" | "LONG_FORM" | "SHORTS";
    minUploadDate?: string;
    maxUploadDate?: string;
    minViews?: number;
    minLikes?: number;
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
}

function parseViewCount(viewText?: string): number {
    if (!viewText) return 0;
    const match = viewText.match(/[\d,.]+/);
    if (!match) return 0;
    
    const numStr = match[0].replace(/,/g, '');
    let mult = 1;
    if (viewText.toLowerCase().includes('k')) mult = 1000;
    if (viewText.toLowerCase().includes('m')) mult = 1000000;
    if (viewText.toLowerCase().includes('b')) mult = 1000000000;
    
    return Math.floor(parseFloat(numStr) * mult);
}

export class YouTubeScraper {
    async init() {
        // Initialization if needed
    }

    async getChannelId(url: string): Promise<string | null> {
        return url; // We just use the URL directly with HttpCrawler
    }

    async scrapeChannel(channelId: string, channelUrl: string, options: ScrapeOptions, pushData: (data: any) => Promise<void>) {
        const urlsToScrape = [];
        if (options.videoType === "ALL" || options.videoType === "LONG_FORM") {
            urlsToScrape.push({ url: `${channelUrl}/videos`, type: "LONG_FORM" });
        }
        if (options.videoType === "ALL" || options.videoType === "SHORTS") {
            urlsToScrape.push({ url: `${channelUrl}/shorts`, type: "SHORTS" });
        }

        const maxItems = options.maxItemsPerChannel || Infinity;
        let totalPushed = 0;

        const crawler = new HttpCrawler({
            requestHandler: async ({ request, body }) => {
                const type = request.userData.type as "LONG_FORM" | "SHORTS";
                const html = body.toString();
                const match = html.match(/var ytInitialData = (\{.*?\});<\/script>/);
                if (!match || !match[1]) {
                    log.warning(`Could not find ytInitialData for ${request.url}`);
                    return;
                }

                const data = JSON.parse(match[1]);
                let channelName = "Unknown Channel";
                if (data.metadata?.channelMetadataRenderer?.title) {
                    channelName = data.metadata.channelMetadataRenderer.title;
                } else if (data.header?.pageHeaderRenderer?.pageTitle) {
                    channelName = data.header.pageHeaderRenderer.pageTitle;
                }

                log.info(`Scraping ${type} for channel: ${channelName}`);

                const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs;
                if (!tabs) return;

                const targetTab = tabs.find((t: any) => t.tabRenderer?.selected);
                if (!targetTab) return;

                const items = targetTab.tabRenderer.content?.richGridRenderer?.contents;
                if (!items) return;

                for (const item of items) {
                    if (totalPushed >= maxItems) break;

                    let videoObj = item.richItemRenderer?.content?.videoRenderer;
                    let lockupObj = item.richItemRenderer?.content?.lockupViewModel;

                    let title = "";
                    let videoId = "";
                    let viewsText = "";
                    let dateText = "";
                    let durationText = "";

                    if (videoObj) {
                        title = videoObj.title?.runs?.[0]?.text || "";
                        videoId = videoObj.videoId;
                        viewsText = videoObj.viewCountText?.simpleText || "";
                        dateText = videoObj.publishedTimeText?.simpleText || "";
                        durationText = videoObj.lengthText?.simpleText || "";
                    } else if (lockupObj) {
                        const meta = lockupObj.metadata?.lockupMetadataViewModel;
                        title = meta?.title?.content || "";
                        videoId = lockupObj.contentId;
                        const metaRows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
                        if (metaRows.length > 0 && metaRows[0].metadataParts) {
                            viewsText = metaRows[0].metadataParts[0]?.text?.content || "";
                            if (metaRows[0].metadataParts.length > 1) {
                                dateText = metaRows[0].metadataParts[1]?.text?.content || "";
                            }
                        }
                    } else {
                        continue; // Maybe a shelf or different type
                    }

                    if (!videoId) continue;

                    const viewCount = parseViewCount(viewsText);
                    
                    if (options.minViews && viewCount < options.minViews) {
                        continue;
                    }

                    const videoData: VideoData = {
                        channelName,
                        channelUrl,
                        videoId,
                        videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
                        title,
                        type,
                        uploadDateText: dateText,
                        viewCount,
                        durationText
                    };

                    await pushData(videoData);
                    totalPushed++;
                }
            }
        });

        await crawler.run(urlsToScrape.map(u => ({ url: u.url, userData: { type: u.type } })));
        log.info(`Finished scraping ${channelUrl}. Total items: ${totalPushed}`);
    }
}
