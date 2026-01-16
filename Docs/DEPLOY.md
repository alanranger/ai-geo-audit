# Deployment Instructions

## Vercel Deployment

This project is configured for deployment on **Vercel** using serverless functions for API endpoints.

### Prerequisites

1. A GitHub account
2. A Vercel account (sign up at https://vercel.com)
3. Google Cloud Console access (for OAuth2 credentials)

### Step 1: Push to GitHub

1. **Initialize Git** (if not already done):
   ```bash
   cd "G:\Dropbox\alan ranger photography\Website Code\AI GEO Audit"
   git init
   ```

2. **Add and Commit Files**:
   ```bash
   git add .
   git commit -m "Initial commit: AI GEO Audit Dashboard"
   ```

3. **Create GitHub Repository**:
   - Go to https://github.com/new
   - Repository name: `ai-geo-audit` (or your preferred name)
   - Description: "AI GEO Audit Dashboard - Automated SEO Analysis"
   - Choose Public or Private
   - **Do NOT** check "Initialize with README"
   - Click "Create repository"

4. **Connect and Push**:
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/ai-geo-audit.git
   git branch -M main
   git push -u origin main
   ```

### Step 2: Deploy to Vercel

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click **Add New Project**
3. Import your GitHub repository (`ai-geo-audit`)
4. Vercel will auto-detect settings:
   - Framework Preset: Other
   - Root Directory: `./`
   - Build Command: (leave empty)
   - Output Directory: `./`
5. Click **Deploy**

### Step 3: Configure Environment Variables

After deployment, configure OAuth2 credentials:

1. Go to your project in Vercel Dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Add these environment variables (see `GSC_API_SETUP.md` for OAuth2 details):
   - `GOOGLE_CLIENT_ID` - Your OAuth2 Client ID
   - `GOOGLE_CLIENT_SECRET` - Your OAuth2 Client Secret
   - `GOOGLE_REFRESH_TOKEN` - Your OAuth2 Refresh Token
   - `SUPABASE_URL` (optional) - Your Supabase project URL (for historical Content/Schema tracking)
   - `SUPABASE_SERVICE_ROLE_KEY` (optional) - Your Supabase service role key (for historical Content/Schema tracking)
4. Select **Production**, **Preview**, and **Development** environments
5. Click **Save**

**Note**: Supabase variables are optional. If not configured, the dashboard will still work but Content/Schema historical trends will show a dashed line using the current score.

### Step 4: Redeploy

After adding environment variables, trigger a new deployment:
- Go to **Deployments** tab
- Click the **⋯** menu on the latest deployment
- Click **Redeploy**

### Step 5: Access Your Dashboard

Your dashboard will be live at:
- `https://ai-geo-audit.vercel.app/` (or your custom domain)

### Custom Domain (Optional)

1. Go to **Settings** → **Domains** in Vercel
2. Add your custom domain (e.g., `audit.alanranger.com`)
3. Configure DNS records as Vercel instructs

### Updating

To update the dashboard after making changes:

```bash
git add .
git commit -m "Update: [describe your changes]"
git push
```

Vercel will automatically rebuild and deploy (usually takes 1-2 minutes).

### Restore Points (Git Tags)

For rollback points, create an annotated git tag and push it:
```bash
git tag -a "restore-YYYY-MM-DD" -m "Restore point"
git push origin "restore-YYYY-MM-DD"
```

### Debug Logs

Debug log files in `debug-logs/` are **kept local** and should not be committed.

**Note**: After each deployment, ensure the version number in `audit-dashboard.html` is updated to reflect the latest commit hash. This helps track which version is currently deployed and prevents troubleshooting outdated versions.

## Troubleshooting

- **404 Error**: Check that `vercel.json` exists and routes are configured correctly
- **Not Updating**: Clear browser cache or wait a few minutes for Vercel to rebuild
- **OAuth2 Errors**: Verify all three environment variables are set in Vercel
- **API Errors**: Check Vercel function logs in the dashboard under **Functions** tab

