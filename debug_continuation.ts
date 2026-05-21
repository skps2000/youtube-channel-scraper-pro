import { HttpCrawler } from 'crawlee';
import fs from 'fs';

async function main() {
    const crawler = new HttpCrawler({
        async requestHandler({ request, body, sendRequest }) {
            const html = body.toString();
            
            // Extract INNERTUBE_API_KEY
            const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"(.*?)"/);
            const apiKey = apiKeyMatch ? apiKeyMatch[1] : null;
            
            // Extract client info
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
                if (!items) return;
                
                console.log(`Found ${items.length} initial items`);
                
                // Find continuation token
                const continuationItem = items.find((i: any) => i.continuationItemRenderer);
                if (continuationItem) {
                    const token = continuationItem.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
                    console.log(`Found continuation token: ${token}`);
                    
                    if (apiKey && clientVersion && token) {
                        const response = await sendRequest({
                            url: `https://www.youtube.com/youtubei/v1/browse?key=${apiKey}`,
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                            },
                            body: JSON.stringify({
                                context: {
                                    client: {
                                        clientName: "WEB",
                                        clientVersion: clientVersion
                                    }
                                },
                                continuation: token
                            })
                        });
                        
                        const contData = JSON.parse(response.body as string);
                        fs.writeFileSync('debug_continuation.json', JSON.stringify(contData, null, 2));
                        
                        const contActions = contData.onResponseReceivedActions;
                        if (contActions && contActions.length > 0) {
                            const newItems = contActions[0].appendContinuationItemsAction?.continuationItems;
                            if (newItems) {
                                console.log(`Successfully fetched ${newItems.length} MORE items via continuation!`);
                                const nextTokenItem = newItems.find((i: any) => i.continuationItemRenderer);
                                if (nextTokenItem) {
                                    console.log(`Next token available: ${nextTokenItem.continuationItemRenderer.continuationEndpoint.continuationCommand.token}`);
                                }
                            } else {
                                console.log("Could not find continuationItems in response");
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
