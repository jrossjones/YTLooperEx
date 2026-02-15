# YTLooper

YouTube video looper with AB loop sections, speed control, and section playlists.

## Tech Stack

- Vanilla HTML, CSS, JavaScript — no frameworks, no build tools, no npm
- YouTube IFrame Player API for video embedding and control
- All state is client-side; localStorage for persistence

## Project Structure

```
index.html   — Page structure, YouTube API script loader
style.css    — Dark theme, responsive layout, timeline/playlist styles
app.js       — All application logic (player, looping, playlist, shortcuts)
CLAUDE.md    — This file
```

## Development

Open `index.html` via a local HTTP server (YouTube API requires `http://` or `https://`):

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000`.

## Conventions

- No external dependencies — everything is vanilla JS
- CSS custom properties (variables) defined in `:root` for theming
- All DOM references cached at initialization, not queried repeatedly
- Section data stored in localStorage with key pattern `ytlooper_sections_{VIDEO_ID}`
- HTML escaping required for any user-provided text rendered to DOM
- Keyboard shortcuts are ignored when user is focused on input/textarea elements

## Key Architecture

- YouTube IFrame API has no `timeupdate` event — a `setInterval` poll (~100ms) handles playhead updates and AB loop enforcement
- Timeline is a custom div-based component (not native range inputs) for cross-browser consistency
- Section playlist supports drag-to-reorder (HTML5 Drag and Drop) and export/import as JSON
- URL hash stores video ID for bookmarkable/shareable links
