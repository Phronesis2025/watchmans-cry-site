# Testing the Analytics System

## Quick Test Steps

### 1. Check if Tracking Script is Loading

1. Open your site in a browser
2. Open Developer Tools (F12)
3. Go to the **Console** tab
4. Look for messages like:
   - `✓ Analytics tracked: /index.html` (on localhost)
   - Or check the **Network** tab for requests to `/api/track`

### 2. Test on Localhost (Easiest)

1. Start your local server:
   ```bash
   npm run dev
   ```
2. Visit `http://localhost:8000` (or your dev port)
3. Open Developer Tools → Console
4. You should see: `✓ Analytics tracked: /index.html`
5. Navigate to different pages
6. Check the Network tab - you should see POST requests to `/api/track`

### 3. Test on Deployed Site

1. Visit your deployed site (e.g., `https://www.watchmanscry.site`)
2. Open Developer Tools → Network tab
3. Filter by "track" or "api"
4. Navigate to a few pages
5. You should see POST requests to `/api/track` with status 204 (No Content)

### 4. Verify Data in Supabase

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Go to **Table Editor**
4. Check the `page_views` table
5. You should see new rows appearing as you visit pages

### 5. Check Admin Dashboard

1. Go to `/admin.html` on your site
2. Sign in with your admin credentials
3. Go to the "Site Metrics" section
4. Click "Refresh"
5. Data should appear (may take a few seconds after visiting pages)

## Common Issues & Solutions

### Issue: No tracking requests in Network tab

**Possible causes:**
- Do Not Track is enabled in your browser
- The analytics script isn't loading
- JavaScript errors blocking execution

**Solutions:**
1. Check if Do Not Track is enabled:
   - Chrome: Settings → Privacy and security → Send a "Do Not Track" request
   - Firefox: Settings → Privacy & Security → Send websites a "Do Not Track" signal
   - Disable it temporarily for testing

2. Check if script is loading:
   - Open Developer Tools → Sources/Network tab
   - Look for `js/analytics.js`
   - Verify it's loading without errors

3. Check Console for errors:
   - Look for red error messages
   - Fix any JavaScript errors

### Issue: 404 or 500 errors on `/api/track`

**Possible causes:**
- Serverless function not deployed
- Environment variables not set
- CORS issues

**Solutions:**
1. Check Vercel deployment:
   - Go to Vercel Dashboard → Your Project → Deployments
   - Verify the latest deployment succeeded
   - Check the Functions tab for `/api/track`

2. Check environment variables:
   - Vercel Dashboard → Project Settings → Environment Variables
   - Verify `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set
   - Redeploy after adding variables

3. Check CORS:
   - The function allows requests from your domain
   - If testing from a different domain, you may need to add it to allowed origins

### Issue: Data not appearing in admin dashboard

**Possible causes:**
- Not signed in as admin
- RLS policies blocking access
- Query errors

**Solutions:**
1. Verify you're signed in:
   - Check that you see "Submissions" section
   - If not, sign in first

2. Check Supabase RLS policies:
   - Supabase Dashboard → Authentication → Policies
   - Verify `page_views` and `visitor_sessions` have policies allowing authenticated reads

3. Check browser console:
   - Look for errors when loading metrics
   - Check Network tab for `/api/analytics-data` requests
   - Verify they return 200 status with data

### Issue: Rate limiting (429 errors)

**This is normal!** The system limits to 10 requests per IP per minute. If you're testing rapidly:
- Wait 1 minute between test batches
- Or test from different IP addresses

## Manual Testing Checklist

- [ ] Analytics script loads (check Network tab)
- [ ] POST requests to `/api/track` return 204
- [ ] Data appears in Supabase `page_views` table
- [ ] Admin dashboard shows metrics
- [ ] Different pages tracked correctly
- [ ] Time on page updates (wait 30+ seconds on a page)
- [ ] Session ID persists across page navigations
- [ ] Do Not Track respected (enable DNT, verify no tracking)

## Testing Different Scenarios

### Test 1: Basic Page View
1. Visit homepage
2. Check Network tab for POST to `/api/track`
3. Verify status 204
4. Check Supabase for new row

### Test 2: Multiple Pages
1. Visit homepage → about → submit
2. Each page should generate a tracking request
3. Check that all pages appear in Supabase

### Test 3: Time on Page
1. Visit a page
2. Wait 35 seconds (past the 30s update interval)
3. Check Network tab for update request
4. Leave the page
5. Check for final time update

### Test 4: Session Persistence
1. Visit homepage (creates session)
2. Navigate to about page
3. Check that both use same session_id in Supabase

### Test 5: Admin Dashboard
1. Visit 3-4 different pages
2. Wait 10 seconds
3. Go to admin page
4. Sign in
5. Check metrics - should show at least 3-4 page views

## Debug Mode

To enable more detailed logging, the analytics script automatically logs on localhost. For production debugging, you can temporarily add:

```javascript
// In js/analytics.js, change console.debug to console.log
console.log('Analytics tracking error:', err);
```

**Remember to remove debug logging before committing!**

## Verifying Data Quality

Once data is flowing, verify:

1. **Page paths are correct**: Check `page_path` column matches actual URLs
2. **Device types detected**: Check `device_type` column (desktop/mobile/tablet)
3. **Countries detected**: Check `country` column (may be null if geolocation fails)
4. **Time on page**: Check `time_on_page` column (should increase over time)
5. **Sessions tracked**: Check `visitor_sessions` table for unique sessions

## Still Not Working?

1. **Check Vercel Function Logs**:
   - Vercel Dashboard → Your Project → Functions
   - Click on `/api/track`
   - Check "Logs" tab for errors

2. **Check Supabase Logs**:
   - Supabase Dashboard → Logs → Postgres Logs
   - Look for errors or blocked queries

3. **Test API directly**:
   ```bash
   curl -X POST https://your-site.vercel.app/api/track \
     -H "Content-Type: application/json" \
     -d '{"page_path":"/test.html","session_id":"test123"}'
   ```
   Should return 204 No Content

4. **Verify tables exist**:
   - Supabase Dashboard → Table Editor
   - Verify `page_views`, `visitor_sessions`, and `rate_limits` tables exist
