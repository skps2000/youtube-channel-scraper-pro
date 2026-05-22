import fs from 'fs';
import { HttpCrawler } from 'crawlee';

async function main() {
    const crawler = new HttpCrawler({
        async requestHandler({ body }) {
            const html = body.toString();
            const match = html.match(/var ytInitialData = (\{.*?\});<\/script>/);
            if (match?.[1]) {
                fs.writeFileSync('debug_channel_data.json', match[1]);
                console.log('Wrote debug_channel_data.json');
            } else {
                console.log('No ytInitialData found');
            }
        }
    });

    await crawler.run(['https://www.youtube.com/@mkbhd/videos']);
}

main().catch(console.error);
