# Chrome Extensions

This repo contains Chrome browser extensions built for personal productivity.

## Extensions

### youtube-channel-filter

**Goal:** Hide or visually block out YouTube video recommendations from channels that have fewer than a configurable subscriber threshold.

**Folder:** `youtube-channel-filter/`

**How it works:**
- Content script runs on YouTube pages
- Detects video cards/recommendations in the feed, search results, and sidebar
- Reads the subscriber count for each channel
- Hides or grays out cards from channels below the configured minimum subscriber count
- User can configure the threshold via a popup UI

## General Notes

- Each extension lives in its own subdirectory with its own `manifest.json`
- Use Manifest V3 (the current Chrome extension standard)
- Extensions are loaded unpacked during development via `chrome://extensions`
