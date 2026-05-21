# YouTube Channel Scraper Pro 🚀

An ultra-fast, robust, and highly customizable Apify Actor for scraping YouTube channel videos. 

Unlike other scrapers that rely on heavy headless browsers or unstable third-party APIs, **YouTube Channel Scraper Pro** directly parses YouTube's internal `ytInitialData`. This ensures lightning-fast execution times, zero CAPTCHA blocking, and maximum reliability.

🔗 **Apify Actor URL:** [https://apify.com/skcho/youtube-channel-scraper-pro](https://apify.com/skcho/youtube-channel-scraper-pro)

---

## ✨ Key Features

- **⚡ Ultra-Fast Extraction:** Scrapes video data in just 1-2 seconds per channel without launching a full browser.
- **🗂️ Long-Form & Shorts Separation:** Precisely filter and categorize videos by their type (Long Form vs Shorts).
- ** Богатый 정보 추출 (Rich Data Extraction):** Automatically extracts Titles, View Counts, Upload Dates, Exact Durations, HQ Thumbnails, and Animated WebP Previews.
- **👍 Optional Deep Crawling (Likes):** Choose to deeply crawl individual video pages in parallel to extract **Like counts**.
- **🎯 Precision Filtering:** Filter out videos that don't meet your criteria (e.g., Minimum Views, Minimum Likes, Max Items).

---

## 🛠️ Module Specification (Input Parameters)

This actor provides a highly detailed Input Schema allowing you to tailor the scraping process exactly to your needs.

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `channelUrls` | `Array<String>` | *(Required)* | A list of YouTube channel URLs you want to scrape. (e.g., `https://www.youtube.com/@mkbhd`) |
| `videoType` | `Enum` | `"ALL"` | The type of videos to scrape. Options: `"ALL"` (All Videos), `"LONG_FORM"` (Long Form Only), `"SHORTS"` (Shorts Only). |
| `minUploadDate` | `String` | `""` | Filter videos uploaded ON or AFTER this date (Format: `YYYY-MM-DD`). |
| `maxUploadDate` | `String` | `""` | Filter videos uploaded ON or BEFORE this date (Format: `YYYY-MM-DD`). |
| `minViews` | `Integer` | `0` | Only scrape videos that have at least this many views. (e.g., `1000000` for 1M+ views). |
| `fetchLikes` | `Boolean` | `false` | **(Slower)** If enabled, the crawler will visit every single video page in parallel to extract exact Like counts. *Warning: Enabling this increases scraping time and Apify credit consumption.* |
| `minLikes` | `Integer` | `0` | *(Requires `fetchLikes: true`)* Only scrape videos with at least this many likes. |
| `maxItemsPerChannel` | `Integer` | `100` | The maximum number of videos to scrape per channel. Set to `0` or a very high number for unlimited (within the first page load). |

---

## 📄 Output Data Structure

The scraper pushes clean, structured JSON data directly to the default Apify Dataset. Below is an example of the extracted data format:

```json
{
  "channelName": "Marques Brownlee",
  "channelUrl": "https://www.youtube.com/@mkbhd",
  "videoId": "eFeDpUVEy48",
  "videoUrl": "https://www.youtube.com/watch?v=eFeDpUVEy48",
  "title": "“The Biggest Android Update Ever”",
  "type": "LONG_FORM",
  "uploadDateText": "7 days ago",
  "viewCount": 4099999,
  "durationText": "12:59",
  "thumbnailUrl": "https://i.ytimg.com/vi/eFeDpUVEy48/hqdefault.jpg?sqp=...",
  "animatedThumbnailUrl": "https://i.ytimg.com/an_webp/eFeDpUVEy48/mqdefault_6s.webp?du=3000&...",
  "likeCount": 125000
}
```

### Data Field Details:
- `channelName`: The official display name of the YouTube channel.
- `type`: Either `"LONG_FORM"` or `"SHORTS"`.
- `viewCount`: Perfectly parsed integer value of views (e.g., `4.1M views` -> `4100000`).
- `durationText`: Exact length of the video (e.g., `12:59`).
- `thumbnailUrl`: The highest quality static thumbnail image URL available.
- `animatedThumbnailUrl`: The 3-second animated WebP preview image shown on YouTube hover.
- `likeCount`: Extracted ONLY if `fetchLikes` is set to `true`. Parsed integer value of likes.

---

## ⚙️ How it Works (Under the Hood)

1. **Phase 1 (Channel Page):** The actor uses `Crawlee`'s `HttpCrawler` to fetch the raw HTML of the target channel's `/videos` and `/shorts` tabs.
2. **Phase 2 (Data Parsing):** It uses Regex to locate the `ytInitialData` JSON object embedded in the HTML script tags. This bypasses the need to render the DOM, drastically reducing compute overhead.
3. **Phase 3 (Parallel Deep Crawl - Optional):** If `fetchLikes` is enabled, the actor dynamically queues up to 10 concurrent HTTP requests (configurable concurrency) to fetch individual video watch pages and extracts the Like count directly from the segmented button view model.

## 🤝 Support & Issues
If you encounter any bugs, missing data, or have feature requests, please reach out via the Apify Issues tab!
