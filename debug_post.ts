import { HttpCrawler } from 'crawlee';

async function main() {
    const crawler = new HttpCrawler({
        async requestHandler({ request, body }) {
            console.log(`Processing ${request.url} - Type: ${request.userData.type}`);
            
            if (request.userData.type === "API") {
                const data = JSON.parse(body.toString());
                const actions = data.onResponseReceivedActions;
                if (actions) {
                    console.log("Got API response correctly");
                }
                return;
            }

            const html = body.toString();
            const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"(.*?)"/);
            const apiKey = apiKeyMatch ? apiKeyMatch[1] : null;
            const clientVersionMatch = html.match(/"INNERTUBE_CLIENT_VERSION":"(.*?)"/);
            const clientVersion = clientVersionMatch ? clientVersionMatch[1] : null;
            
            const match = html.match(/var ytInitialData = (\{.*?\});<\/script>/);
            if (match && match[1]) {
                const data = JSON.parse(match[1]);
                const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs;
                if (!tabs) return;
                const targetTab = tabs.find((t: any) => t.tabRenderer?.selected);
                if (!targetTab) return;
                const items = targetTab.tabRenderer.content?.richGridRenderer?.contents;
                const continuationItem = items.find((i: any) => i.continuationItemRenderer);
                if (continuationItem) {
                    const token = continuationItem.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
                    console.log("Found token, adding POST request to queue...");
                    await request.crawler.addRequests([{
                        url: `https://www.youtube.com/youtubei/v1/browse?key=${apiKey}`,
                        method: 'POST',
                        payload: JSON.stringify({
                            context: { client: { clientName: "WEB", clientVersion } },
                            continuation: token
                        }),
                        headers: { 'Content-Type': 'application/json' },
                        userData: { type: 'API' }
                    }]);
                }
            }
        }
    });

    await crawler.run(['https://www.youtube.com/@mkbhd/videos']);
}

main().catch(console.error);
