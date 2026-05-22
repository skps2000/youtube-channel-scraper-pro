import { PlaywrightCrawler } from 'crawlee';

async function main() {
    const crawler = new PlaywrightCrawler({
        maxConcurrency: 1,
        requestHandlerTimeoutSecs: 300,
        async requestHandler({ page, request }) {
            console.log(`Processing ${request.url}`);
            
            // Wait for initial videos to load
            await page.waitForSelector('ytd-rich-item-renderer', { timeout: 60000 });
            console.log("Initial videos loaded.");

            const maxItems = 40;
            let currentItemCount = 0;
            let previousItemCount = 0;
            let unchangedScrolls = 0;

            // Scroll loop
            while (currentItemCount < maxItems && unchangedScrolls < 5) {
                // Scroll down
                await page.evaluate(() => window.scrollBy(0, window.innerHeight * 5));
                await page.waitForTimeout(2000); // Wait for videos to load

                const items = await page.$$('ytd-rich-item-renderer');
                currentItemCount = items.length;
                console.log(`Currently loaded items: ${currentItemCount}`);

                if (currentItemCount === previousItemCount) {
                    unchangedScrolls++;
                } else {
                    unchangedScrolls = 0;
                }
                previousItemCount = currentItemCount;
            }

            // Extract data
            const items = await page.$$('ytd-rich-item-renderer');
            const data = [];
            for (let i = 0; i < Math.min(items.length, maxItems); i++) {
                const item = items[i];
                const titleEl = await item.$('#video-title, #video-title-link');
                const title = titleEl ? await titleEl.textContent() : "Unknown";
                const href = titleEl ? await titleEl.getAttribute('href') : "";
                
                // Metadata (views and time)
                const metadataEls = await item.$$('#metadata-line span');
                let viewsText = "";
                let dateText = "";
                if (metadataEls.length >= 2) {
                    viewsText = await metadataEls[0].textContent() || "";
                    dateText = await metadataEls[1].textContent() || "";
                } else if (metadataEls.length === 1) {
                    viewsText = await metadataEls[0].textContent() || "";
                }

                // Duration
                const durationEl = await item.$('ytd-thumbnail-overlay-time-status-renderer span');
                const durationText = durationEl ? await durationEl.textContent() : "";

                // Thumbnail
                const imgEl = await item.$('img.yt-core-image');
                const thumbnailUrl = imgEl ? await imgEl.getAttribute('src') : "";

                data.push({
                    title: title?.trim(),
                    videoId: href?.split('v=')[1]?.split('&')[0] || href?.split('/shorts/')[1]?.split('?')[0],
                    viewsText: viewsText?.trim(),
                    dateText: dateText?.trim(),
                    durationText: durationText?.trim(),
                    thumbnailUrl
                });
            }

            console.log(`Extracted ${data.length} items`);
            console.log("First item:", data[0]);
            console.log("Last item:", data[data.length - 1]);
        }
    });

    await crawler.run(['https://www.youtube.com/@mkbhd/videos']);
}

main().catch(console.error);
