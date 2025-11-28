# AI GEO Audit Dashboard

Automated SEO analysis tool for tracking AI-powered search visibility, entity recognition, and SERP behavior.

## Quick Start

### Local Testing
Simply open `audit-dashboard.html` in your browser - no server needed!

## Deploy to GitHub Pages

### Initial Setup

1. **Initialize Git repository** (if not already done):
   ```bash
   cd "G:\Dropbox\alan ranger photography\Website Code\AI GEO Audit"
   git init
   git add .
   git commit -m "Initial commit: AI GEO Audit Dashboard"
   ```

2. **Create GitHub Repository**:
   - Go to [GitHub](https://github.com/new)
   - Create a new repository (e.g., `ai-geo-audit`)
   - **Do NOT** initialize with README, .gitignore, or license

3. **Push to GitHub**:
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/ai-geo-audit.git
   git branch -M main
   git push -u origin main
   ```

4. **Enable GitHub Pages**:
   - Go to your repository on GitHub
   - Click **Settings** → **Pages**
   - Under **Source**, select **Deploy from a branch**
   - Select **main** branch and **/ (root)** folder
   - Click **Save**

5. **Access your dashboard**:
   - Your dashboard will be live at: `https://YOUR_USERNAME.github.io/ai-geo-audit/`
   - Or with custom domain if configured

### Updating the Dashboard

After making changes:
```bash
git add .
git commit -m "Update dashboard"
git push
```

GitHub Pages will automatically rebuild (usually takes 1-2 minutes).

## Features

- **5 Pillar Score Tracking**: Local Entity, Service Area, Authority, Visibility, Content/Schema
- **Real-time Data**: Google Search Console API integration
- **Visual Dashboards**: Radar charts, trend graphs, metrics cards
- **RAG Status**: Color-coded Red/Amber/Green indicators
- **Configuration**: Save API keys and settings locally

## Setup

1. Get your Google Search Console API key from [Google Cloud Console](https://console.cloud.google.com/)
2. Enable the Search Console API
3. Enter your API key in the dashboard configuration panel
4. Enter your property URL (e.g., `https://alanranger.com`)
5. Click "Run Audit Scan"

## Current Status

- ✅ Dashboard UI complete
- ✅ Visual charts and graphs
- ✅ Configuration management
- ⚠️ Using mock data (API integration in progress)

## Next Steps

- [ ] Connect real Google Search Console API
- [ ] Add Google Analytics integration
- [ ] Add schema validation API
- [ ] Add SERP tracking
- [ ] Add automated scheduling

## Notes

- API keys are stored in browser localStorage (not sent to any server)
- All processing is client-side for privacy
- Charts use Chart.js (loaded via CDN)

