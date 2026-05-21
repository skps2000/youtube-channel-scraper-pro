import { HttpCrawler } from 'crawlee';
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
    const match = text.match(/[\d,.]+/);
    if (!match) return 0;
    
    const numStr = match[0].replace(/,/g, '');
    let mult = 1;
    if (text.toLowerCase().includes('k')) mult = 1000;
    if (text.toLowerCase().includes('m')) mult = 1000000;
    if (text.toLowerCase().includes('b')) mult = 1000000000;
    
    return Math.floor(parseFloat(numStr) * mult);
}

export class YouTubeScraper {
    async init() {}

    async getChannelId(url: string): Promise<string | null> {
        return url;
    }

    async scrapeChannel(channelId: string, channelUrl: string, options: ScrapeOptions, pushData: (data: any) => Promise<void>) {
        const urlsToScrape = [];
        if (options.videoType === "ALL" || options.videoType === "LONG_FORM") {
            urlsToScrape.push({ url: `${channelUrl}/videos`, type: "LONG_FORM_TAB" });
        }
        if (options.videoType === "ALL" || options.videoType === "SHORTS") {
            urlsToScrape.push({ url: `${channelUrl}/shorts`, type: "SHORTS_TAB" });
        }

        const maxItems = options.maxItemsPerChannel && options.maxItemsPerChannel > 0 ? options.maxItemsPerChannel : Infinity;
        let totalPushed = 0;

        const processItems = async (items: any[], type: string, channelName: string, currentCrawler: any) => {
            let nextToken = null;
            for (const item of items) {
                if (totalPushed >= maxItems) break;

                // Check for continuation token
                if (item.continuationItemRenderer) {
                    nextToken = item.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token;
                    continue;
                }

                let videoObj = item.richItemRenderer?.content?.videoRenderer;
                let lockupObj = item.richItemRenderer?.content?.lockupViewModel;

                let title = "";
                let videoId = "";
                let viewsText = "";
                let dateText = "";
                let durationText = "";
                let thumbnailUrl = "";
                let animatedThumbnailUrl = "";

                if (videoObj) {
                    title = videoObj.title?.runs?.[0]?.text || "";
                    videoId = videoObj.videoId;
                    viewsText = videoObj.viewCountText?.simpleText || "";
                    dateText = videoObj.publishedTimeText?.simpleText || "";
                    durationText = videoObj.lengthText?.simpleText || "";
                    thumbnailUrl = videoObj.thumbnail?.thumbnails?.[0]?.url || "";
                    animatedThumbnailUrl = videoObj.richThumbnail?.movingThumbnailRenderer?.movingThumbnailDetails?.thumbnails?.[0]?.url || "";
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
                    
                    const accessibilityLabel = lockupObj.rendererContext?.accessibilityContext?.label || "";
                    const timeMatch = accessibilityLabel.match(/\d+\s*(minutes?|seconds?|hours?),?\s*\d*\s*(minutes?|seconds?)?/);
                    if (timeMatch) {
                        durationText = timeMatch[0];
                    }
                    
                    const sources = lockupObj.contentImage?.thumbnailViewModel?.image?.sources;
                    if (sources && sources.length > 0) {
                        thumbnailUrl = sources[sources.length - 1].url;
                    }
                    
                    const overlays = lockupObj.contentImage?.thumbnailViewModel?.overlays;
                    if (overlays) {
                        for (const overlay of overlays) {
                            if (overlay.animatedThumbnailOverlayViewModel) {
                                const animSources = overlay.animatedThumbnailOverlayViewModel.thumbnail?.sources;
                                if (animSources && animSources.length > 0) {
                                    animatedThumbnailUrl = animSources[0].url;
                                }
                            }
                            if (overlay.thumbnailBottomOverlayViewModel?.badges) {
                                for (const badge of overlay.thumbnailBottomOverlayViewModel.badges) {
                                    if (badge.thumbnailBadgeViewModel?.text) {
                                        durationText = badge.thumbnailBadgeViewModel.text;
                                    }
                                }
                            }
                        }
                    }
                } else {
                    continue;
                }

                if (!videoId) continue;

                const viewCount = parseCount(viewsText);
                
                if (options.minViews && viewCount < options.minViews) {
                    continue;
                }

                const videoType = type === "LONG_FORM_TAB" ? "LONG_FORM" : "SHORTS";

                const videoData: VideoData = {
                    channelName,
                    channelUrl,
                    videoId,
                    videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
                    title,
                    type: videoType,
                    uploadDateText: dateText,
                    viewCount,
                    durationText,
                    thumbnailUrl,
                    animatedThumbnailUrl
                };

                if (options.fetchLikes) {
                    await currentCrawler.addRequests([{
                        url: videoData.videoUrl,
                        userData: { type: "VIDEO_PAGE", videoData }
                    }]);
                } else {
                    await pushData(videoData);
                }
                totalPushed++;
            }
            return nextToken;
        };

        const crawler = new HttpCrawler({
            maxConcurrency: 10,
            requestHandlerTimeoutSecs: 300, // Important: Allows long pagination loops
            requestHandler: async ({ request, body, crawler: currentCrawler, sendRequest }) => {
                const type = request.userData.type as "LONG_FORM_TAB" | "SHORTS_TAB" | "VIDEO_PAGE";
                
                if (type === "VIDEO_PAGE") {
                    const html = body.toString();
                    const match = html.match(/var ytInitialData = (\{.*?\});<\/script>/);
                    if (!match || !match[1]) return;
                    const data = JSON.parse(match[1]);

                    const videoData = request.userData.videoData as VideoData;
                    let likeCountText = "";
                    const findLikes = (obj: any) => {
                        if (likeCountText) return;
                        if (!obj) return;
                        if (Array.isArray(obj)) {
                            for (const item of obj) findLikes(item);
                        } else if (typeof obj === 'object') {
                            if (obj.segmentedLikeDislikeButtonViewModel) {
                                const btn = obj.segmentedLikeDislikeButtonViewModel.likeButtonViewModel?.likeButtonViewModel?.toggleButtonViewModel?.toggleButtonViewModel?.defaultButtonViewModel?.buttonViewModel;
                                if (btn && btn.title) {
                                    likeCountText = btn.title;
                                }
                            }
                            if (!likeCountText) {
                                for (const key of Object.keys(obj)) findLikes(obj[key]);
                            }
                        }
                    };
                    findLikes(data.contents);
                    
                    videoData.likeCount = parseCount(likeCountText);
                    
                    if (options.minLikes && videoData.likeCount < options.minLikes) {
                        return;
                    }

                    await pushData(videoData);
                    log.info(`Pushed video ${videoData.videoId} with ${videoData.likeCount} likes.`);
                    return;
                }

                // Channel tab logic
                const html = body.toString();
                const match = html.match(/var ytInitialData = (\{.*?\});<\/script>/);
                if (!match || !match[1]) {
                    log.warning(`Could not find ytInitialData for ${request.url}`);
                    return;
                }

                const data = JSON.parse(match[1]);
                
                // Extract auth/client for pagination
                const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"(.*?)"/);
                const apiKey = apiKeyMatch ? apiKeyMatch[1] : null;
                const clientVersionMatch = html.match(/"INNERTUBE_CLIENT_VERSION":"(.*?)"/);
                const clientVersion = clientVersionMatch ? clientVersionMatch[1] : null;

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

                // Process first page
                let nextToken = await processItems(items, type, channelName, currentCrawler);

                // Pagination Loop
                while (nextToken && totalPushed < maxItems && apiKey && clientVersion) {
                    log.info(`Fetching next page for ${channelName} (${type})...`);
                    try {
                        const response = await sendRequest({
                            url: `https://www.youtube.com/youtubei/v1/browse?key=${apiKey}`,
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                context: { client: { clientName: "WEB", clientVersion } },
                                continuation: nextToken
                            })
                        });
                        
                        const contData = JSON.parse(response.body as string);
                        const contActions = contData.onResponseReceivedActions;
                        if (contActions && contActions.length > 0) {
                            const newItems = contActions[0].appendContinuationItemsAction?.continuationItems;
                            if (newItems && newItems.length > 0) {
                                nextToken = await processItems(newItems, type, channelName, currentCrawler);
                            } else {
                                break;
                            }
                        } else {
                            break;
                        }
                    } catch (err: any) {
                        log.warning(`Pagination failed: ${err.message}`);
                        break;
                    }
                }
            }
        });

        await crawler.run(urlsToScrape.map(u => ({ url: u.url, userData: { type: u.type } })));
        log.info(`Finished scraping ${channelUrl}. Total channel items queued/pushed: ${totalPushed}`);
    }
}
