# Deployment Instructions

## GitHub Pages Deployment

### Step 1: Initialize Git (if not already done)

```bash
cd "G:\Dropbox\alan ranger photography\Website Code\AI GEO Audit"
git init
```

### Step 2: Add and Commit Files

```bash
git add .
git commit -m "Initial commit: AI GEO Audit Dashboard"
```

### Step 3: Create GitHub Repository

1. Go to https://github.com/new
2. Repository name: `ai-geo-audit` (or your preferred name)
3. Description: "AI GEO Audit Dashboard - Automated SEO Analysis"
4. Choose Public or Private
5. **Do NOT** check "Initialize with README"
6. Click "Create repository"

### Step 4: Connect and Push

```bash
git remote add origin https://github.com/YOUR_USERNAME/ai-geo-audit.git
git branch -M main
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username.

### Step 5: Enable GitHub Pages

1. Go to your repository on GitHub
2. Click **Settings** (top menu)
3. Click **Pages** (left sidebar)
4. Under **Source**:
   - Select **Deploy from a branch**
   - Branch: **main**
   - Folder: **/ (root)**
5. Click **Save**

### Step 6: Access Your Dashboard

Your dashboard will be live at:
- `https://YOUR_USERNAME.github.io/ai-geo-audit/`

GitHub Pages usually takes 1-2 minutes to build and deploy.

### Custom Domain (Optional)

If you want to use a custom domain (e.g., `audit.alanranger.com`):

1. In GitHub Pages settings, enter your custom domain
2. Add a `CNAME` file in the repository root with your domain
3. Configure DNS records as GitHub instructs

### Updating

To update the dashboard after making changes:

```bash
git add .
git commit -m "Update: [describe your changes]"
git push
```

GitHub Pages will automatically rebuild.

## Troubleshooting

- **404 Error**: Wait 2-3 minutes after enabling Pages, or check that `index.html` exists
- **Not Updating**: Clear browser cache or wait a few minutes for GitHub to rebuild
- **API Keys**: Remember API keys are stored in browser localStorage, not in the code

