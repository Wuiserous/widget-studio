# Widget Studio Community Library

This folder is the public widget registry used by Widget Studio.

## Share a Widget

1. Open Widget Studio.
2. Select a completed widget.
3. Click **Share**.
4. Upload the generated ZIP to a GitHub release or attach it to a widget submission issue.
5. Paste the generated registry entry from your clipboard.

## Registry Format

Widgets are listed in `registry.json`.

```json
{
  "id": "year-countdown",
  "name": "Year Countdown",
  "author": "Your name",
  "description": "A live countdown to the end of the year.",
  "version": "1.0.0",
  "tags": ["time", "minimal"],
  "previewUrl": "",
  "downloadUrl": "https://github.com/Wuiserous/widget-studio/releases/download/community-year-countdown/year-countdown-widget.zip",
  "stars": 0,
  "downloads": 0,
  "updatedAt": "2026-06-16T00:00:00.000Z"
}
```

Each package must include these files at the ZIP root:

- `index.html`
- `styles.css`
- `widget.js`
- `manifest.json`

