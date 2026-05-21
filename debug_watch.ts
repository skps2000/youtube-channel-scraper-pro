import { HttpCrawler } from 'crawlee';
import fs from 'fs';

async function main() {
    const crawler = new HttpCrawler({
        async requestHandler({ request, body }) {
            const html = body.toString();
            const match = html.match(/var ytInitialData = (\{.*?\});<\/script>/);
            if (match && match[1]) {
                const data = JSON.parse(match[1]);
                fs.writeFileSync('debug_watch_dump.json', JSON.stringify(data, null, 2));
                
                // Let's try to extract like count
                const contents = data.contents?.twoColumnWatchNextResults?.results?.results?.contents;
                if (contents) {
                    const videoPrimaryInfo = contents.find((c: any) => c.videoPrimaryInfoRenderer);
                    if (videoPrimaryInfo) {
                        const actions = videoPrimaryInfo.videoPrimaryInfoRenderer.videoActions?.menuRenderer?.topLevelButtons;
                        if (actions) {
                            const likeButton = actions.find((a: any) => a.toggleButtonRenderer?.defaultIcon?.iconType === 'LIKE');
                            if (likeButton) {
                                console.log("Like count:", likeButton.toggleButtonRenderer.defaultText?.simpleText || likeButton.toggleButtonRenderer.defaultText?.accessibility?.accessibilityData?.label);
                            }
                        }
                    }
                    
                    // Sometimes it's in a different place (segmentedLikeButton)
                    const segmentedLike = contents.find((c: any) => true); // just traversing
                    // Actually, let's just write a recursive finder
                    let likeCount = "Not found";
                    const findLikes = (obj: any) => {
                        if (!obj) return;
                        if (Array.isArray(obj)) obj.forEach(findLikes);
                        else if (typeof obj === 'object') {
                            if (obj.segmentedLikeDislikeButtonViewModel) {
                                const btn = obj.segmentedLikeDislikeButtonViewModel.likeButtonViewModel?.likeButtonViewModel?.toggleButtonViewModel?.toggleButtonViewModel?.defaultButtonViewModel?.buttonViewModel;
                                if (btn) {
                                    likeCount = btn.title || btn.accessibilityText;
                                    console.log("Found in segmented view model:", likeCount);
                                }
                            }
                            if (obj.likeButtonViewModel) {
                                const btn = obj.likeButtonViewModel.toggleButtonViewModel?.toggleButtonViewModel?.defaultButtonViewModel?.buttonViewModel;
                                if (btn) {
                                    likeCount = btn.title || btn.accessibilityText;
                                    console.log("Found in likeButtonViewModel:", likeCount);
                                }
                            }
                            for (const key of Object.keys(obj)) findLikes(obj[key]);
                        }
                    };
                    findLikes(contents);
                }
            }
        }
    });

    await crawler.run(['https://www.youtube.com/watch?v=eFeDpUVEy48']);
}

main().catch(console.error);
