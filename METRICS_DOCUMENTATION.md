# Site Metrics Documentation

This document outlines the metrics we capture and how they are collected.

## Metrics Captured

### 1. **Page Views**
- **What it measures:** Total number of page loads across the site
- **How it's captured:**
  - Client-side: JavaScript (`js/analytics.js`) automatically tracks when a page loads
  - Captures: `page_path` (URL path), `page_title` (browser tab title)
  - Sent to: `/api/track` endpoint immediately on page load

### 2. **Unique Visitors**
- **What it measures:** Number of distinct visitors (identified by hashed IP address)
- **How it's captured:**
  - Server-side: IP address is extracted from request headers
  - Privacy protection: IP is hashed with SHA-256 before storage
  - Tracking: Each unique hashed IP counts as one visitor
  - New vs returning: Determined by checking if IP exists in database

### 3. **Top Pages**
- **What it measures:** Most visited pages on the site
- **How it's captured:**
  - Aggregated from page view data
  - Groups page views by `page_path` and counts occurrences
  - Shows top 10 pages by view count

### 4. **Device Types**
- **What it measures:** Breakdown of desktop, mobile, and tablet visitors
- **How it's captured:**
  - Client-side: `User-Agent` string is sent from browser
  - Server-side: Parsed using regex patterns to detect:
    - Mobile: Contains "mobile", "android", "iphone", etc.
    - Tablet: Contains "tablet", "ipad", etc.
    - Desktop: Default if not mobile or tablet
  - Stored as: `device_type` field in database

### 5. **Time on Page**
- **What it measures:** How long visitors spend on each page (in seconds)
- **How it's captured:**
  - Client-side: Tracks time from page load to page exit
  - Updates sent every 30 seconds while user is on page
  - Final time sent when user navigates away or closes tab
  - Uses `beforeunload` and `pagehide` events for reliability
  - Uses `navigator.sendBeacon()` to ensure data is sent even if page closes

### 6. **Geographic Data (Country)**
- **What it measures:** Country-level location of visitors
- **How it's captured:**
  - Server-side: IP address is sent to geolocation API (ipapi.co or ip-api.com)
  - Privacy: Only country-level data is stored (not city or precise location)
  - Fallback: Uses Vercel/Cloudflare headers if available
  - Stored as: 2-letter country code (e.g., "US", "GB")

### 7. **Referrer Information**
- **What it measures:** Where visitors came from (external sites, search engines, etc.)
- **How it's captured:**
  - Client-side: `document.referrer` provides the previous page URL
  - Server-side: Domain is extracted from referrer URL
  - Stored as: `referrer_domain` (e.g., "google.com", "facebook.com")

### 8. **Browser & Operating System**
- **What it measures:** Browser type and OS of visitors
- **How it's captured:**
  - Client-side: `User-Agent` string sent from browser
  - Server-side: Parsed using regex to detect:
    - Browsers: Chrome, Firefox, Safari, Edge, Opera, Internet Explorer
    - Operating Systems: Windows, macOS, Linux, Android, iOS
  - Stored as: `browser` and `os` fields

### 9. **Sessions**
- **What it measures:** Individual browsing sessions
- **How it's captured:**
  - Client-side: Unique session ID generated and stored in `sessionStorage`
  - Format: `sess_[timestamp]_[random]` (e.g., "sess_1768277028233_rz88b76kb")
  - Session ends when browser tab/window closes
  - Used to track bounce rate (single-page sessions)

### 10. **Bounce Rate**
- **What it measures:** Percentage of visitors who view only one page
- **How it's captured:**
  - Calculated by checking if a session has only one page view
  - Marked as `is_bounce: true` in database for single-page sessions

## Data Collection Flow

```
1. User visits page
   ↓
2. js/analytics.js loads and checks Do Not Track setting
   ↓
3. If tracking allowed:
   - Generates/retrieves session ID
   - Captures: page path, title, referrer, user agent
   - Sends data to /api/track endpoint
   ↓
4. Server (api/track.js) receives data:
   - Extracts and hashes IP address
   - Parses user agent (device, browser, OS)
   - Gets country from IP geolocation
   - Checks rate limits
   - Stores in Supabase database
   ↓
5. Time tracking:
   - Starts timer on page load
   - Sends updates every 30 seconds
   - Sends final time when user leaves
   ↓
6. Admin dashboard (admin.html):
   - Authenticates admin user
   - Queries /api/analytics-data endpoint
   - Aggregates and displays metrics
```

## Privacy Protections

1. **IP Hashing:** All IP addresses are hashed with SHA-256 before storage
2. **No Cookies:** Uses `sessionStorage` only (cleared when tab closes)
3. **Do Not Track:** Respects browser DNT setting
4. **Limited Geolocation:** Only country-level data (not city/precise location)
5. **No PII:** No personally identifiable information collected
6. **Rate Limiting:** Prevents abuse with 10 requests/minute per IP limit

## Database Tables

- **`page_views`:** Stores each page view with metadata
- **`visitor_sessions`:** Tracks unique visitors and sessions
- **`rate_limits`:** Prevents abuse of tracking endpoint

## Technical Implementation

- **Client-side:** `js/analytics.js` (runs in browser)
- **Server-side:** `api/track.js` (Vercel serverless function)
- **Data aggregation:** `api/analytics-data.js` (Vercel serverless function)
- **Storage:** Supabase PostgreSQL database
- **Display:** `admin.html` (admin dashboard)
