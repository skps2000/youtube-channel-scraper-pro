import { Innertube, UniversalCache } from 'youtubei.js';

async function main() {
  const yt = await Innertube.create({ cache: new UniversalCache(false) });
  console.log("Resolving URL...");
  const channel = await yt.resolveURL('https://www.youtube.com/@mkbhd');
  console.log("Channel payload keys:", Object.keys(channel));
  
  if (channel.payload && channel.payload.browseId) {
      const channelId = channel.payload.browseId;
      console.log("Channel ID:", channelId);
      const ch = await yt.getChannel(channelId);
      console.log("Channel Name:", ch.title);
      
      const videos = await ch.getVideos();
      console.log("First video:", videos.videos[0].title);
      
      const shorts = await ch.getShorts();
      console.log("First short:", shorts.videos[0].title);
  }
}

main().catch(console.error);
