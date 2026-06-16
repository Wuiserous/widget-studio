# Widget Studio Community Library

This folder is the public widget registry used by Widget Studio.

## Share a Widget

1. Open Widget Studio.
2. Select a completed widget.
3. Click **Share**.
4. A ZIP package and `.registry-entry.json` file will be created.
5. The GitHub submission issue opens with the registry entry prefilled.
6. Drag the generated ZIP into the issue before submitting.
7. After review, maintainers add the entry to `registry.json`; then it appears in the Community tab for everyone.

Submissions do not appear instantly. The Community tab only shows approved entries from `registry.json`.

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
