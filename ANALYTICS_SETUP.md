# Analytics System Setup Guide

## Overview

The Watchman's Cry now uses a privacy-first, self-hosted analytics system built with Supabase. This system tracks essential metrics while protecting user privacy.

## What's Been Implemented

### Phase 1 Metrics (Implemented)
1. ✅ **Page Views** - Total and per-page views
2. ✅ **Unique Visitors** - Based on hashed IP addresses
3. ✅ **Top Pages** - Most viewed pages
5. ✅ **Device Types** - Desktop, mobile, tablet breakdown
8. ✅ **Time on Page** - Average time spent on each page
10. ✅ **Geographic Data** - Country-level visitor locations

## Files Created

### Client-Side
- `js/analytics.js` - Tracking script (respects Do Not Track, uses sessionStorage)

### Server-Side (Vercel Serverless Functions)
- `api/track.js` - Receives tracking data, hashes IPs, stores in Supabase
- `api/analytics-data.js` - Queries aggregated metrics for admin dashboard

### Database (Supabase)
- `page_views` table - Stores individual page view events
- `visitor_sessions` table - Tracks unique visitors and sessions

### Documentation
- `privacy-policy.html` - Comprehensive privacy policy
- `ANALYTICS_METRICS.md` - Full list of metrics and priorities

## Setup Required

### 1. Environment Variables (Vercel)

Add these to your Vercel project settings → Environment Variables:

```
SUPABASE_URL=https://ikksmrbqrirvenqlylxo.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlra3NtcmJxcmlydmVucWx5bHhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODI5ODgsImV4cCI6MjA4Mzc1ODk4OH0.1pKE6_LFTii8R-xY8WvWlXR23mXW3sUpPpKniL9fFvc
```

**Important:** 
- Get your `SUPABASE_SERVICE_ROLE_KEY` from Supabase Dashboard → Settings → API
- Never expose the service role key in client-side code
- The service role key is only used in serverless functions

### 2. Install Dependencies

```bash
npm install
```

This installs `@supabase/supabase-js` for the serverless functions.

### 3. Database Tables

The tables have already been created via Supabase MCP migrations:
- ✅ `page_views` table with RLS policies
- ✅ `visitor_sessions` table with RLS policies

### 4. Deploy to Vercel

After setting environment variables:
1. Commit and push your changes
2. Vercel will automatically deploy
3. The analytics system will start tracking immediately

## How It Works

### Tracking Flow

1. **User visits page** → `js/analytics.js` loads
2. **Script checks Do Not Track** → If enabled, tracking is skipped
3. **Data collected** → Page path, title, referrer, user agent, session ID
4. **Sent to server** → POST to `/api/track` endpoint
5. **Server processes** → Hashes IP, parses user agent, gets country
6. **Stored in Supabase** → `page_views` and `visitor_sessions` tables
7. **Admin views data** → Queries `/api/analytics-data` endpoint

### Privacy Protections

- ✅ IP addresses hashed with SHA-256 (cannot be reversed)
- ✅ No cookies used (only sessionStorage, cleared on browser close)
- ✅ Respects Do Not Track header
- ✅ Only country-level geolocation (not city/street)
- ✅ No personal information collected
- ✅ RLS policies restrict data access to authenticated admins only

## Viewing Analytics

1. Go to `/admin.html`
2. Sign in with your Supabase admin account
3. View metrics in the "Site Metrics" section
4. Use the period selector to view different time ranges (7 days, 30 days, all time)

## Troubleshooting

### No data appearing
- Check that environment variables are set in Vercel
- Verify Supabase tables exist and RLS policies are correct
- Check browser console for errors
- Verify the tracking script is loading on pages

### Rate limiting errors
- The system limits to 10 requests per IP per minute
- This is normal for high-traffic pages
- Rate limiting uses Supabase queries (no separate table needed)

### Geolocation not working
- The system tries multiple methods: Vercel headers → Cloudflare headers → ipapi.co API
- If all fail, country will be null (this is acceptable)
- Free IP geolocation APIs have rate limits

## Next Steps (Future Phases)

Phase 2 metrics to add later:
- Sessions (duration, pages per session)
- Bounce Rate
- Entry/Exit Pages

Phase 3 metrics (optional):
- Scroll Depth
- Search Terms
- Peak Hours/Days
- Returning Visitors

## Support

For issues or questions:
- Check the privacy policy: `/privacy-policy.html`
- Review RLS policies in Supabase Dashboard
- Check Vercel function logs for errors
