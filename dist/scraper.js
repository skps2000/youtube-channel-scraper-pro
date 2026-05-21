import { HttpCrawler } from 'crawlee';
import { log } from 'apify';
function parseCount(text) {
    if (!text)
        return 0;
    const match = text.match(/[\d,.]+/);
    if (!match)
        return 0;
    const numStr = match[0].replace(/,/g, '');
    let mult = 1;
    if (text.toLowerCase().includes('k'))
        mult = 1000;
    if (text.toLowerCase().includes('m'))
        mult = 1000000;
    if (text.toLowerCase().includes('b'))
        mult = 1000000000;
    return Math.floor(parseFloat(numStr) * mult);
}
export class YouTubeScraper {
    async init() { }
    async getChannelId(url) {
        return url;
    }
    async scrapeChannel(channelId, channelUrl, options, pushData) {
        const urlsToScrape = [];
        if (options.videoType === "ALL" || options.videoType === "LONG_FORM") {
            urlsToScrape.push({ url: `${channelUrl}/videos`, type: "LONG_FORM_TAB" });
        }
        if (options.videoType === "ALL" || options.videoType === "SHORTS") {
            urlsToScrape.push({ url: `${channelUrl}/shorts`, type: "SHORTS_TAB" });
        }
        const maxItems = options.maxItemsPerChannel || Infinity;
        let totalPushed = 0;
        const crawler = new HttpCrawler({
            // Increase max concurrency to handle video pages faster if fetchLikes is enabled
            maxConcurrency: 10,
            requestHandler: async ({ request, body, crawler: currentCrawler }) => {
                const type = request.userData.type;
                const html = body.toString();
                const match = html.match(/var ytInitialData = (\{.*?\});<\/script>/);
                if (!match || !match[1]) {
                    log.warning(`Could not find ytInitialData for ${request.url}`);
                    return;
                }
                const data = JSON.parse(match[1]);
                if (type === "VIDEO_PAGE") {
                    // Extract likes
                    const videoData = request.userData.videoData;
                    let likeCountText = "";
                    const findLikes = (obj) => {
                        if (likeCountText)
                            return;
                        if (!obj)
                            return;
                        if (Array.isArray(obj)) {
                            for (const item of obj)
                                findLikes(item);
                        }
                        else if (typeof obj === 'object') {
                            if (obj.segmentedLikeDislikeButtonViewModel) {
                                const btn = obj.segmentedLikeDislikeButtonViewModel.likeButtonViewModel?.likeButtonViewModel?.toggleButtonViewModel?.toggleButtonViewModel?.defaultButtonViewModel?.buttonViewModel;
                                if (btn && btn.title) {
                                    likeCountText = btn.title;
                                }
                            }
                            if (!likeCountText) {
                                for (const key of Object.keys(obj))
                                    findLikes(obj[key]);
                            }
                        }
                    };
                    findLikes(data.contents);
                    videoData.likeCount = parseCount(likeCountText);
                    if (options.minLikes && videoData.likeCount < options.minLikes) {
                        return; // skip if below min likes
                    }
                    await pushData(videoData);
                    log.info(`Pushed video ${videoData.videoId} with ${videoData.likeCount} likes.`);
                    return;
                }
                // Otherwise, it's a channel tab page
                let channelName = "Unknown Channel";
                if (data.metadata?.channelMetadataRenderer?.title) {
                    channelName = data.metadata.channelMetadataRenderer.title;
                }
                else if (data.header?.pageHeaderRenderer?.pageTitle) {
                    channelName = data.header.pageHeaderRenderer.pageTitle;
                }
                log.info(`Scraping ${type} for channel: ${channelName}`);
                const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs;
                if (!tabs)
                    return;
                const targetTab = tabs.find((t) => t.tabRenderer?.selected);
                if (!targetTab)
                    return;
                const items = targetTab.tabRenderer.content?.richGridRenderer?.contents;
                if (!items)
                    return;
                for (const item of items) {
                    if (totalPushed >= maxItems)
                        break;
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
                    }
                    else if (lockupObj) {
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
                        // Extract duration
                        const accessibilityLabel = lockupObj.rendererContext?.accessibilityContext?.label || "";
                        const timeMatch = accessibilityLabel.match(/\d+\s*(minutes?|seconds?|hours?),?\s*\d*\s*(minutes?|seconds?)?/);
                        if (timeMatch) {
                            durationText = timeMatch[0];
                        }
                        // Extract thumbnails
                        const sources = lockupObj.contentImage?.thumbnailViewModel?.image?.sources;
                        if (sources && sources.length > 0) {
                            thumbnailUrl = sources[sources.length - 1].url; // Usually the last one is highest res
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
                    }
                    else {
                        continue;
                    }
                    if (!videoId)
                        continue;
                    const viewCount = parseCount(viewsText);
                    if (options.minViews && viewCount < options.minViews) {
                        continue;
                    }
                    const videoType = type === "LONG_FORM_TAB" ? "LONG_FORM" : "SHORTS";
                    const videoData = {
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
                        // Enqueue video page to get likes
                        await currentCrawler.addRequests([{
                                url: videoData.videoUrl,
                                userData: { type: "VIDEO_PAGE", videoData }
                            }]);
                    }
                    else {
                        await pushData(videoData);
                    }
                    totalPushed++;
                }
            }
        });
        await crawler.run(urlsToScrape.map(u => ({ url: u.url, userData: { type: u.type } })));
        log.info(`Finished scraping ${channelUrl}. Total channel items queued/pushed: ${totalPushed}`);
    }
}
