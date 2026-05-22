import fs from 'fs';

const data = JSON.parse(fs.readFileSync('debug_channel_data.json', 'utf-8'));

function findVideos(obj: any): any[] {
    let videos: any[] = [];
    if (!obj || typeof obj !== 'object') return videos;
    if (Array.isArray(obj)) {
        for (const item of obj) videos = videos.concat(findVideos(item));
        return videos;
    }
    if (obj.richItemRenderer) {
        videos.push(obj.richItemRenderer);
    }
    for (const key of Object.keys(obj)) {
        videos = videos.concat(findVideos(obj[key]));
    }
    return videos;
}

const videos = findVideos(data);
console.log(`Found ${videos.length} videos`);
if (videos.length > 0) {
    fs.writeFileSync('debug_first_video.json', JSON.stringify(videos[0], null, 2));
    console.log('Wrote debug_first_video.json');
}
