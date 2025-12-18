# Optimisation Tracking Security — Admin Key Gate

## Overview

All `/api/optimisation/*` endpoints are secured with a simple admin key gate and same-origin guard. This prevents anonymous public callers from using privileged endpoints while keeping the app "single-user" (no multi-user auth complexity).

## Environment Variables

### Required (Server-side only)

Add these to your Vercel project environment variables and local `.env.local`:

#### `ARP_ADMIN_KEY`
- **Type**: String (32+ characters recommended)
- **Description**: Long random secret used to authenticate API requests
- **Security**: Server-only (never exposed to client, no `NEXT_PUBLIC_` prefix)
- **Example**: `arp_admin_abc123xyz456def789ghi012jkl345mno678pqr901stu234vwx567`
- **Generation**: Use a secure random string generator (32+ characters)

#### `ARP_ALLOWED_ORIGINS` (Optional)
- **Type**: Comma-separated string
- **Description**: List of allowed origins for same-origin guard (hardening layer)
- **Format**: `http://localhost:3000,https://ai-geo-audit.vercel.app`
- **Note**: If not set, origin check is skipped (admin key is still required)

## Implementation

### Server-Side Guard

**File**: `lib/api/requireAdmin.js`

- Checks for `x-arp-admin-key` header matching `ARP_ADMIN_KEY`
- Optionally validates request origin against `ARP_ALLOWED_ORIGINS`
- Returns 401 if admin key missing/invalid
- Returns 403 if origin not allowed (when `ARP_ALLOWED_ORIGINS` is set)

### Client-Side

**File**: `audit-dashboard.html` (inline utilities)

- Admin key stored in `sessionStorage` (cleared on browser close)
- Utilities: `getAdminKey()`, `setAdminKey()`, `hasAdminKey()`, `clearAdminKey()`
- All `/api/optimisation/*` fetch calls include `x-arp-admin-key` header
- UI input in "Optimisation Tracking Security" section for setting key

### Protected Endpoints

All endpoints require admin key:

- `POST /api/optimisation/status` - Bulk status fetch
- `POST /api/optimisation/task` - Create task
- `PATCH /api/optimisation/task/[id]` - Update task
- `POST /api/optimisation/task/[id]/cycle` - Start new cycle

## Usage

1. **Set environment variables in Vercel**:
   - Go to Project Settings → Environment Variables
   - Add `ARP_ADMIN_KEY` (generate a secure random string)
   - Optionally add `ARP_ALLOWED_ORIGINS` (comma-separated list)

2. **Set admin key in UI**:
   - Open dashboard
   - Navigate to "Optimisation Tracking Security" section
   - Enter your admin key (must match `ARP_ADMIN_KEY` from Vercel)
   - Click "Save Admin Key"
   - Key is stored in sessionStorage for the current browser session

3. **Verify**:
   - Track/Manage buttons should work after key is set
   - Without key, buttons are disabled and show warning
   - API calls without key return 401 Unauthorized

## Security Notes

- **Admin key is the primary gate** - origin check is a hardening layer only
- **No multi-user support** - single admin key for all users
- **Session storage** - key cleared when browser closes
- **Server-only secret** - `ARP_ADMIN_KEY` never exposed to client bundle
- **No Supabase auth** - simple key-based authentication

## Troubleshooting

### 401 Unauthorized
- Check that `ARP_ADMIN_KEY` is set in Vercel environment variables
- Verify admin key in UI matches the value in Vercel
- Check browser console for error messages

### 403 Forbidden Origin
- Verify `ARP_ALLOWED_ORIGINS` includes your current origin
- Check that origin format is correct (protocol + host, no trailing slash)

### Buttons Disabled
- Set admin key in "Optimisation Tracking Security" section
- Refresh page after setting key
- Check that key is saved (status indicator should show "✓ Admin key set")
