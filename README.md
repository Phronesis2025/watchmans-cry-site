# The Watchman's Cry: Common Sense Reborn

A weekly digital broadsheet reviving the boldness of colonial-era pamphlets. Static website with 18th-century aesthetic, no backend, no tracking.

## 🚀 Deployment

This project is configured for automatic deployment to Vercel via GitHub.

**Repository:** [GitHub](https://github.com/Phronesis2025/watchmans-cry-site)

**Deployment Status:** Connected to Vercel with automatic deployments enabled.

### Automatic Deployment Workflow

1. Make changes locally
2. Commit and push to GitHub:
   ```bash
   git add .
   git commit -m "Your commit message"
   git push
   ```
3. Vercel automatically deploys on every push to `main` branch

### Initial Vercel Setup (Already Complete)

The project is configured with `vercel.json` for static site deployment:

- Framework: Static HTML (no build required)
- Routes configured for all pages
- Automatic HTTPS and global CDN

**Vercel Benefits:**

- Free custom domain support
- Global CDN for fast loading
- Automatic HTTPS
- Preview deployments for pull requests

## Local Development

```bash
# Install dependencies (if using npm run dev)
npm install

# Start local server
npm run dev
```

## 📁 Project Structure

```
.
├── index.html              # Homepage with latest edition
├── prelaunch.html          # Pre-launch landing page with waitlist
├── archive.html            # Archive listing of past editions
├── about.html              # About page with core principles
├── staff.html              # Staff page with persona bios
├── submit.html             # Submit form for Common Man's Counsel
├── vercel.json             # Vercel deployment configuration
├── package.json            # npm dependencies (http-server for dev)
├── .gitignore              # Git ignore rules
├── css/
│   └── style.css          # Main stylesheet (18th-century aesthetic)
├── images/                # Image assets (woodcuts, placeholders)
├── js/
│   └── script.js          # Minimal JavaScript (placeholder)
└── archive/               # Past edition pages
    ├── edition-2026-01-09.html
    └── edition-2026-01-16.html
```

## ✨ Features

- **Pure Static Site**: HTML/CSS/JS only - no build process required
- **Privacy-First**: No tracking scripts, analytics, or external dependencies (except Google Fonts)
- **Mobile-Responsive**: Mobile-first design with responsive breakpoints
- **18th-Century Aesthetic**: Sepia background, Garamond font, drop caps, ornamental dividers
- **Fast Loading**: Optimized static files, no JavaScript bloat
- **Zero Config**: Works out of the box with Vercel

## 🎨 Design Philosophy

The site mimics an 18th-century broadsheet newspaper:

- Sepia/parchment background (`#f4e8d4`)
- Black ink text (`#000`)
- EB Garamond serif font from Google Fonts
- Drop caps for section openings
- Dotted dividers between sections
- Woodcut-style image placeholders

## 📝 Content Sections

- **Opening Dispatch**: Weekly introduction and mission statement
- **The Plain Truth**: Fact-based analysis and reporting
- **Prophetic Parallels**: Historical lessons and comparisons
- **Common Man's Counsel**: Reader questions and responses
- **Archive**: Past editions preserved for reference

## 🔒 Security & Privacy

- No user tracking
- No analytics scripts
- No external dependencies (except Google Fonts)
- Forms use `mailto:` actions (no backend required)
- All data stays client-side

## 📄 License

All content © 2026 The Watchman's Cry: Common Sense Reborn
