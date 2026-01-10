# The Watchman's Cry: Common Sense Reborn

Static broadsheet-style site. 18th-century aesthetic, no backend, no tracking.

## Deploy to Vercel (Recommended)

1. Push this repo to GitHub
2. Go to https://vercel.com → New Project → Import Git Repository
3. Select the repo
4. Framework Preset: Other (or leave blank - Vercel auto-detects static)
5. Root Directory: leave empty (project root)
6. Build & Output: no changes needed
7. Deploy

Vercel gives free custom domain support, global CDN, automatic HTTPS.

## Local Development

```bash
# Install dependencies (if using npm run dev)
npm install

# Start local server
npm run dev
```

## Project Structure

```
.
├── index.html          # Homepage
├── prelaunch.html      # Pre-launch landing page
├── archive.html        # Archive listing
├── about.html          # About page
├── staff.html          # Staff page
├── submit.html         # Submit form page
├── css/
│   └── style.css      # Main stylesheet
├── images/            # Image assets
├── js/
│   └── script.js      # Minimal JavaScript
└── archive/           # Past edition pages
```

## Notes

- Pure static HTML/CSS/JS - no build process required
- No tracking scripts or analytics
- Mobile-responsive design
- 18th-century broadsheet aesthetic
