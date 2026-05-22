# YouTube Channel Scraper Pro 🚀

A high-performance, reliable Apify Actor for scraping YouTube channel videos — including Long-Form and Shorts — with advanced filtering and infinite scroll support.

🔗 **Apify Actor URL:** [https://apify.com/skcho/youtube-channel-scraper-pro](https://apify.com/skcho/youtube-channel-scraper-pro)

---

## ✨ Key Features

- **🔄 Infinite Scroll (Pagination):** Automatically scrolls through the entire channel page using a real browser — no 30-video limit.
- **🗂️ Long-Form & Shorts Separation:** Precisely scrape and categorize videos by type.
- **📦 Rich Data Extraction:** Titles, View Counts, Upload Dates, Durations, HQ Thumbnails, and Animated WebP Previews — all extracted out of the box.
- **👍 Optional Like Count Extraction:** A lightweight, high-concurrency HTTP-based fetcher grabs like counts at **~430 videos/min** without launching extra browsers.
- **🎯 Precision Filtering:** Filter by minimum views, likes, upload date range, and more.
- **🧠 Hybrid Architecture:** `PlaywrightCrawler` handles real-browser scrolling; `HttpCrawler` handles likes — minimizing memory usage and maximizing speed.

---

## ⚡ Performance

| Scenario | Speed |
| :--- | :--- |
| Channel scroll + data extract (100 videos) | ~15 seconds |
| Like count fetch (per 100 videos, `fetchLikes: true`) | ~15 seconds |
| **Total for 100 videos with likes** | **~30 seconds** |

> Likes are fetched at **~430 requests/min** in parallel via lightweight HTTP requests — **no extra browser needed**.

---

## 🛠️ Input Parameters

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `channelUrls` | `Array<String>` | *(Required)* | YouTube channel URLs to scrape (e.g., `https://www.youtube.com/@mkbhd`). Multiple channels supported. |
| `videoType` | `Enum` | `"ALL"` | Which video type to scrape: `"ALL"`, `"LONG_FORM"`, or `"SHORTS"`. |
| `minUploadDate` | `String` | `""` | Only include videos uploaded **on or after** this date. Format: `YYYY-MM-DD`. |
| `maxUploadDate` | `String` | `""` | Only include videos uploaded **on or before** this date. Format: `YYYY-MM-DD`. |
| `minViews` | `Integer` | `0` | Only include videos with at least this many views. (e.g., `1000000` for 1M+). |
| `maxItemsPerChannel` | `Integer` | `100` | Maximum videos to scrape **per channel**. Uses infinite scroll to exceed YouTube's default 30-video page limit. |
| `fetchLikes` | `Boolean` | `false` | If enabled, fetches exact Like counts for every video via fast parallel HTTP requests. Adds ~15s per 100 videos. |
| `minLikes` | `Integer` | `0` | *(Requires `fetchLikes: true`)* Only include videos with at least this many likes. |

---

## 📄 Output Data Structure

Each video is pushed as a JSON object to the Apify Dataset:

```json
{
  "channelName": "Marques Brownlee",
  "channelUrl": "https://www.youtube.com/@mkbhd",
  "videoId": "eFeDpUVEy48",
  "videoUrl": "https://www.youtube.com/watch?v=eFeDpUVEy48",
  "title": "The Biggest Android Update Ever",
  "type": "LONG_FORM",
  "uploadDateText": "8 days ago",
  "viewCount": 4099999,
  "durationText": "12:59",
  "thumbnailUrl": "https://i.ytimg.com/vi/eFeDpUVEy48/hqdefault.jpg",
  "animatedThumbnailUrl": "https://i.ytimg.com/an_webp/eFeDpUVEy48/mqdefault_6s.webp",
  "likeCount": 125000
}
```

### Field Reference

| Field | Type | Description |
| :--- | :--- | :--- |
| `channelName` | `String` | Official channel display name |
| `channelUrl` | `String` | Input channel URL |
| `videoId` | `String` | YouTube video ID |
| `videoUrl` | `String` | Full `youtube.com/watch?v=...` URL |
| `title` | `String` | Video title |
| `type` | `String` | `"LONG_FORM"` or `"SHORTS"` |
| `uploadDateText` | `String` | Relative upload date (e.g., `"8 days ago"`) |
| `viewCount` | `Integer` | Parsed integer view count |
| `durationText` | `String` | Video duration string (e.g., `"12:59"`) |
| `thumbnailUrl` | `String` | Highest-quality static thumbnail URL |
| `animatedThumbnailUrl` | `String` | 3-second animated WebP preview URL |
| `likeCount` | `Integer` | Like count — present only when `fetchLikes: true` |

---

## ⚙️ How It Works (Architecture)

This actor uses a **two-phase hybrid architecture** to maximize both stability and speed:

### Phase 1 — Scroll & Extract (PlaywrightCrawler)
A real Chromium browser navigates to the channel's `/videos` and `/shorts` tabs. It automatically scrolls down the page, triggering YouTube's infinite scroll to load more videos, until `maxItemsPerChannel` is reached or the page end is detected. Video metadata is then extracted directly from the rendered DOM.

**Browser optimizations:**
- Blocks unnecessary resources (images, fonts, media) to reduce memory usage
- Disables GPU, extensions, and background services
- Anti-bot fingerprint masking (`navigator.webdriver` suppressed)

### Phase 2 — Like Count Fetch (HttpCrawler, Optional)
If `fetchLikes` is enabled, up to **20 concurrent lightweight HTTP requests** are made to individual `youtube.com/watch?v=...` pages. Like counts are extracted by parsing the embedded `ytInitialData` JSON object — **no browser required**. This runs at ~430 requests/min.

---

## 🤝 Support & Issues
Found a bug or have a feature request? Please reach out via the Apify Issues tab!
