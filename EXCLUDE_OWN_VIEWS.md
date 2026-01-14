# How to Exclude Your Own Views from Analytics

This guide explains how to filter out your own page views from the analytics dashboard so you can see accurate visitor metrics.

## Method 1: Server-Side IP Filtering (Recommended)

This method filters your views at the server level, so they never appear in any analytics queries.

### Step 1: Find Your IP Hash

1. Visit `/get-my-ip-hash.html` on your website
2. Click the "Get My IP Hash" button
3. Copy the displayed hash

**Note:** If you access your site from multiple locations (home, office, mobile), you'll need to get the hash for each IP address.

### Step 2: Add to Vercel Environment Variables

1. Go to your Vercel project dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Add a new variable:
   - **Name:** `EXCLUDED_IP_HASHES`
   - **Value:** Your IP hash (or comma-separated list: `hash1,hash2,hash3`)
   - **Environment:** Select all (Production, Preview, Development)
4. Click **Save**
5. **Redeploy** your application for changes to take effect

### How It Works

- Your IP address is hashed using SHA-256 (same algorithm used for all visitors)
- The hash is stored in the `EXCLUDED_IP_HASHES` environment variable
- All analytics queries automatically exclude page views from those IP hashes
- This works across all metrics: page views, visitors, devices, geography, time on page, and hourly views

## Method 2: Client-Side Opt-Out (Browser-Specific)

This method disables tracking entirely in your browser using localStorage. This is useful for quick testing or if you don't want to set up environment variables.

### How to Opt Out

1. Open your browser's developer console (Press F12)
2. Go to the **Console** tab
3. Run this command:
   ```javascript
   localStorage.setItem("watchmans_cry_opt_out", "true");
   ```
4. Refresh the page - tracking will be disabled

### How to Opt Back In

Run this command in the console:

```javascript
localStorage.removeItem("watchmans_cry_opt_out");
```

### Limitations

- Only works in the browser where you run the command
- Doesn't affect other devices or browsers
- If you clear browser data, you'll need to opt out again
- Your previous views will still appear in analytics (only future views are excluded)

## Which Method Should I Use?

- **Use Method 1 (Server-Side)** if:

  - You want to exclude your views from all analytics permanently
  - You access the site from multiple devices/locations
  - You want to filter historical data (after setting it up)

- **Use Method 2 (Client-Side)** if:
  - You just want to quickly test without your own views
  - You don't have access to Vercel environment variables
  - You only need it for one browser temporarily

## Troubleshooting

### My views are still showing up

1. **For Method 1:**

   - Make sure you've redeployed after adding the environment variable
   - Verify the hash is correct (check `/get-my-ip-hash.html`)
   - If you have multiple IPs, make sure all are included (comma-separated)
   - Check that the environment variable is set for the correct environment (Production/Preview/Development)

2. **For Method 2:**
   - Make sure you ran the localStorage command in the correct browser
   - Check that localStorage is enabled (some privacy modes disable it)
   - Clear cache and refresh the page

### How do I get hashes for multiple IPs?

1. Visit `/get-my-ip-hash.html` from each location/device
2. Copy each hash
3. In Vercel, set `EXCLUDED_IP_HASHES` to: `hash1,hash2,hash3` (comma-separated, no spaces)

### Can I exclude IPs that have already been tracked?

Yes! Once you add the IP hash to the environment variable and redeploy, all future analytics queries will exclude those IPs. However, **existing data in the database will still contain your views**. To remove historical data, you would need to manually delete those records from Supabase (not recommended unless necessary).

## Technical Details

- **IP Hashing:** Uses SHA-256 algorithm (same as visitor tracking)
- **Privacy:** Your actual IP address is never stored, only the hash
- **Performance:** Filtering happens at the database query level, so it's efficient
- **Scope:** Applies to all metrics: pageviews, visitors, devices, geography, time on page, and hourly views
