import { PlaywrightCrawler } from 'crawlee';
import fs from 'fs';

async function main() {
    const crawler = new PlaywrightCrawler({
        maxConcurrency: 1,
        async requestHandler({ page, request }) {
            await page.waitForSelector('ytd-rich-item-renderer');
            const html = await page.evaluate(() => {
                const el = document.querySelector('ytd-rich-item-renderer');
                return el ? el.innerHTML : "";
            });
            fs.writeFileSync('debug_dom.html', html);
            console.log("Wrote debug_dom.html");
        }
    });
    await crawler.run(['https://www.youtube.com/@mkbhd/videos']);
}

main().catch(console.error);
