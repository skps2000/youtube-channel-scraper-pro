import { HttpCrawler } from 'crawlee';
import fs from 'fs';

async function main() {
    const crawler = new HttpCrawler({
        async requestHandler({ request, body }) {
            const html = body.toString();
            const match = html.match(/var ytInitialData = (\{.*?\});<\/script>/);
            if (match && match[1]) {
                const data = JSON.parse(match[1]);
                
                const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs;
                if (tabs) {
                    const videosTab = tabs.find((t: any) => t.tabRenderer?.selected);
                    if (videosTab) {
                        const items = videosTab.tabRenderer.content?.richGridRenderer?.contents;
                        if (items && items.length > 0) {
                            const video = items[0].richItemRenderer?.content?.lockupViewModel;
                            if (video) {
                                fs.writeFileSync('debug_video_dump.json', JSON.stringify(video, null, 2));
                                console.log("Dumped full video object to debug_video_dump.json");
                            }
                        }
                    }
                }
            }
        }
    });

    await crawler.run(['https://www.youtube.com/@mkbhd/videos']);
}

main().catch(console.error);
