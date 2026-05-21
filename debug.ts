import { Innertube, UniversalCache } from 'youtubei.js';

async function main() {
    const yt = await Innertube.create({ cache: new UniversalCache(false) });
    const ch = await yt.getChannel("UCBJycsmduvYEL83R_U4JriQ");
    let videosTab = await ch.getVideos();
    
    const extractVideos = (obj: any): any[] => {
        let results: any[] = [];
        const find = (o: any) => {
            if (!o) return;
            if (Array.isArray(o)) {
                o.forEach(find);
            } else if (typeof o === 'object') {
                if (o.lockupViewModel && o.lockupViewModel.contentId) {
                    results.push(o.lockupViewModel);
                }
                for (const key of Object.keys(o)) {
                    if (key !== 'lockupViewModel') {
                        find(o[key]);
                    }
                }
            }
        };
        find(obj.page);
        return results;
    };
    
    let items = extractVideos(videosTab);
    console.log("Initial items:", items.length);
    if (items.length > 0) {
        console.log("First item id:", items[0].contentId);
    }
    
    if (videosTab.has_continuation) {
        videosTab = await videosTab.getContinuation();
        const moreItems = extractVideos(videosTab);
        console.log("Continuation items:", moreItems.length);
    }
}

main().catch(console.error);
