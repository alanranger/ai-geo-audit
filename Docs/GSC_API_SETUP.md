# Google Search Console API Setup Guide

## Important: OAuth2 Required

Google Search Console API **does not use API keys** - it requires **OAuth2 authentication**. You'll need to set up OAuth2 credentials.

## Step 1: Enable Google Search Console API

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project (or create a new one)
3. Navigate to **APIs & Services** → **Library**
4. Search for "Google Search Console API"
5. Click **Enable**

## Step 2: Create OAuth2 Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth client ID**
3. If prompted, configure the OAuth consent screen first:
   - Choose **External** (unless you have a Google Workspace)
   - Fill in required fields (App name, User support email, etc.)
   - Add your email to test users
   - Save and continue
4. For Application type, select **Web application**
5. Add authorized redirect URIs:
   - `http://localhost:3000` (for local testing)
   - Your Vercel deployment URL (optional)
6. Click **Create**
7. **Save the Client ID and Client Secret** - you'll need these!

## Step 3: Get Refresh Token

You need to generate a refresh token that the serverless function can use:

### Option A: Using OAuth2 Playground (Easiest)

1. Go to [OAuth2 Playground](https://developers.google.com/oauthplayground/)
2. Click the gear icon (⚙️) in top right
3. Check "Use your own OAuth credentials"
4. Enter your **Client ID** and **Client Secret**
5. In the left panel, find **Search Console API v3**
6. Check `https://www.googleapis.com/auth/webmasters.readonly`
7. Click **Authorize APIs**
8. Sign in with your Google account (the one that has access to Search Console)
9. Click **Exchange authorization code for tokens**
10. **Copy the Refresh Token** - this is what you need!

### Option B: Using a Script

You can also use a Node.js script to generate the refresh token. Let me know if you need this approach.

## Step 4: Deploy to Vercel (if not already done)

If you haven't deployed to Vercel yet, see `Docs/DEPLOY.md` for full deployment instructions.

The project must be deployed to Vercel before you can add environment variables.

## Step 5: Add Environment Variables to Vercel

1. Go to your Vercel project dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Add these three variables:

   ```
   GOOGLE_CLIENT_ID=your_client_id_here
   GOOGLE_CLIENT_SECRET=your_client_secret_here
   GOOGLE_REFRESH_TOKEN=your_refresh_token_here
   ```

4. Make sure to select **Production**, **Preview**, and **Development** environments
5. Click **Save**
6. **Important**: After adding environment variables, you must redeploy for them to take effect

## Step 6: Redeploy After Adding Environment Variables

After adding the environment variables, you must trigger a new deployment:

1. Go to your Vercel project dashboard
2. Navigate to **Deployments** tab
3. Click the **⋯** menu on the latest deployment
4. Click **Redeploy**
5. Wait for deployment to complete (usually 1-2 minutes)

## Step 7: Verify Search Console Access

Make sure the Google account you used to generate the refresh token has access to the Search Console property you want to query (e.g., `alanranger.com`).

## Step 8: Test the Integration

1. Open your dashboard at `https://ai-geo-audit.vercel.app/` (or your custom domain)
2. Enter your property URL (e.g., `https://alanranger.com`)
3. Click "Run Audit Scan"
4. Check the debug log for any authentication errors

## Troubleshooting

### Error: "OAuth2 credentials not configured"
- Make sure all three environment variables are set in Vercel
- Redeploy after adding environment variables

### Error: "Failed to get access token"
- Check that your refresh token is still valid
- Regenerate the refresh token if needed

### Error: "Failed to fetch Search Console data"
- Verify the property URL format (should be domain without https://)
- Make sure your Google account has access to that Search Console property
- Check that the Search Console API is enabled in your Google Cloud project

## Security Notes

- Never commit OAuth credentials to Git
- The serverless function handles authentication server-side
- Client-side code never sees your credentials
- Refresh tokens can be revoked in Google Cloud Console if compromised


