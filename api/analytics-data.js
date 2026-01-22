// Vercel Serverless Function: Analytics Data Endpoint
// Returns aggregated analytics data for admin dashboard
// Now uses Google Analytics 4 (GA4) API instead of Supabase

import { createClient } from '@supabase/supabase-js';
import { BetaAnalyticsDataClient } from '@google-analytics/data';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ikksmrbqrirvenqlylxo.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlra3NtcmJxcmlydmVucWx5bHhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODI5ODgsImV4cCI6MjA4Mzc1ODk4OH0.1pKE6_LFTii8R-xY8WvWlXR23mXW3sUpPpKniL9fFvc';
// Use service role key for admin queries (bypasses RLS)
// This is safe because we verify authentication before using it
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// GA4 Configuration
const GA4_PROPERTY_ID = process.env.GA4_PROPERTY_ID || '520877834';
const GA4_SERVICE_ACCOUNT_KEY = process.env.GA4_SERVICE_ACCOUNT_KEY;

// Initialize GA4 client if credentials are available
let analyticsDataClient = null;
if (GA4_SERVICE_ACCOUNT_KEY) {
  try {
    const credentials = JSON.parse(GA4_SERVICE_ACCOUNT_KEY);
    analyticsDataClient = new BetaAnalyticsDataClient({
      credentials: credentials
    });
    console.log('GA4 client initialized successfully. Property ID:', GA4_PROPERTY_ID);
  } catch (error) {
    console.error('Failed to initialize GA4 client:', error);
    console.error('GA4_SERVICE_ACCOUNT_KEY present but invalid JSON');
  }
} else {
  console.warn('GA4_SERVICE_ACCOUNT_KEY environment variable not set. GA4 metrics will not work.');
}

// Verify Supabase authentication token
async function verifyAuth(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.substring(7);
  
  // Verify the token is valid using anon key client
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) {
    console.error('Auth verification error:', error);
    return false;
  }
  
  return true;
}

// Get excluded IP hashes from environment variable
// Format: comma-separated list of SHA-256 hashes (e.g., "hash1,hash2,hash3")
function getExcludedIPHashes() {
  const excludedIPs = process.env.EXCLUDED_IP_HASHES || '';
  if (!excludedIPs) {
    return [];
  }
  // Split by comma and trim whitespace
  return excludedIPs.split(',').map(hash => hash.trim()).filter(hash => hash.length > 0);
}

// Normalize page paths - combine / and /index.html as the same page
// Note: Section paths (/section/...) are preserved as-is
function normalizePagePath(path) {
  if (!path) return '/';
  if (path === '/index.html' || path === 'index.html') {
    return '/';
  }
  // Preserve section paths
  if (path.startsWith('/section/')) {
    return path;
  }
  return path;
}

// Get date filter based on period
function getDateFilter(period) {
  const now = new Date();
  let startDate = null;

  if (period === '7d') {
    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (period === '30d') {
    startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
  // 'all' means no date filter

  return startDate ? startDate.toISOString() : null;
}

// Get GA4 date range based on period
function getGA4DateRange(period) {
  // Use UTC to avoid timezone issues
  const today = new Date();
  const todayUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  
  const formatDate = (date) => {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const endDate = formatDate(todayUTC);
  let startDate;

  if (period === '7d') {
    const start = new Date(todayUTC);
    start.setUTCDate(start.getUTCDate() - 6); // 7 days including today
    startDate = formatDate(start);
  } else if (period === '30d') {
    const start = new Date(todayUTC);
    start.setUTCDate(start.getUTCDate() - 29); // 30 days including today
    startDate = formatDate(start);
  } else {
    // 'all' - use a date that covers the data (from CSV: data starts Dec 25, 2025)
    // Use December 2025 as start to ensure we capture all data
    startDate = '2025-12-01';
  }

  console.log(`GA4 Date Range for period "${period}": ${startDate} to ${endDate} (UTC)`);
  return { startDate, endDate };
}

export default async function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify authentication
  const authHeader = req.headers.authorization;
  const isAuthenticated = await verifyAuth(authHeader);
  
  if (!isAuthenticated) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // CORS headers
  const origin = req.headers.origin || req.headers.referer;
  const allowedOrigins = [
    'https://www.watchmanscry.site',
    'https://watchmanscry.site',
    'http://localhost:8000',
    'http://localhost:3000'
  ];

  if (origin) {
    const isAllowed = allowedOrigins.some(allowed => origin.startsWith(allowed));
    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  try {
    const { metric, period = '7d' } = req.query;

    if (!metric) {
      return res.status(400).json({ error: 'Metric parameter required' });
    }

    // Create Supabase client for queries
    // If service role key is available, use it (bypasses RLS - safe because we verified auth)
    // Otherwise, use anon key with user's token in headers (respects RLS)
    let supabase;
    if (SUPABASE_SERVICE_ROLE_KEY) {
      supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    } else {
      // Fallback: use anon key with user's token
      const token = authHeader.substring(7);
      supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      });
    }
    
    const dateFilter = getDateFilter(period);
    const excludedIPHashes = getExcludedIPHashes();

    let result = {};

    switch (metric) {
      case 'pageviews': {
        if (!analyticsDataClient) {
          console.error('GA4 client not initialized for pageviews metric');
          return res.status(503).json({ error: 'GA4 not configured' });
        }

        const { startDate, endDate } = getGA4DateRange(period);
        const propertyPath = `properties/${GA4_PROPERTY_ID}`;
        console.log(`Fetching pageviews from GA4: ${startDate} to ${endDate}, Property: ${propertyPath}`);
        
        // First, try to verify property access with a simple query using a very wide date range
        try {
          const today = new Date();
          const twoYearsAgo = new Date(today);
          twoYearsAgo.setFullYear(today.getFullYear() - 2);
          const wideStartDate = twoYearsAgo.toISOString().split('T')[0];
          
          const testResponse = await analyticsDataClient.runReport({
            property: propertyPath,
            dateRanges: [{ startDate: wideStartDate, endDate }], // Very wide date range
            metrics: [{ name: 'sessions' }],
            limit: 1
          });
          console.log('Property access test (wide range):', {
            rowCount: testResponse.rowCount || 0,
            rowsLength: testResponse.rows?.length || 0,
            hasData: (testResponse.rowCount || 0) > 0,
            dateRange: `${wideStartDate} to ${endDate}`
          });
          
          // Also try with "all time" - use a date that covers the actual data (from CSV: starts Dec 25, 2025)
          const allTimeResponse = await analyticsDataClient.runReport({
            property: propertyPath,
            dateRanges: [{ startDate: '2025-12-01', endDate }], // Start from Dec 2025 to capture all data
            metrics: [{ name: 'screenPageViews' }],
            limit: 1
          });
          console.log('All-time test query:', {
            rowCount: allTimeResponse.rowCount || 0,
            rowsLength: allTimeResponse.rows?.length || 0,
            value: allTimeResponse.rows?.[0]?.metricValues?.[0]?.value || 'none'
          });
        } catch (testError) {
          console.error('Property access test failed:', {
            message: testError.message,
            code: testError.code,
            status: testError.status,
            property: propertyPath,
            fullError: JSON.stringify(testError, Object.getOwnPropertyNames(testError)).substring(0, 500)
          });
        }

        try {
          // Get total pageviews and top pages
          // IMPORTANT: GA4 requires at least one dimension when querying, or use keepEmptyRows
          const [totalResponse, pagesResponse, dailyResponse] = await Promise.all([
            // Total pageviews - GA4 may return empty rows array even when rowCount > 0
            // So we check rowCount, not rows.length
            analyticsDataClient.runReport({
              property: `properties/${GA4_PROPERTY_ID}`,
              dateRanges: [{ startDate, endDate }],
              metrics: [{ name: 'screenPageViews' }],
              keepEmptyRows: false, // Don't return rows with zero values
            }),
            // Top pages
            analyticsDataClient.runReport({
              property: `properties/${GA4_PROPERTY_ID}`,
              dateRanges: [{ startDate, endDate }],
              dimensions: [{ name: 'pagePath' }],
              metrics: [{ name: 'screenPageViews' }],
              orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
              limit: 10,
            }),
            // Daily breakdown
            analyticsDataClient.runReport({
              property: `properties/${GA4_PROPERTY_ID}`,
              dateRanges: [{ startDate, endDate }],
              dimensions: [{ name: 'date' }],
              metrics: [{ name: 'screenPageViews' }],
              orderBys: [{ dimension: { dimensionName: 'date' } }],
            }),
          ]);

          // CRITICAL FIX: Based on logs, the response shows data but we're not accessing it correctly
          // The log shows totalResponseKeys: ['0', '1', '2'] which means it's being treated as an array
          // But Promise.all should have already destructured it. Let's check the actual structure.
          console.log('DEBUG: Response structure check:', {
            totalResponseIsArray: Array.isArray(totalResponse),
            totalResponseType: typeof totalResponse,
            totalResponseConstructor: totalResponse?.constructor?.name,
            totalResponseHasRows: totalResponse && 'rows' in totalResponse,
            totalResponseHasRowCount: totalResponse && 'rowCount' in totalResponse,
            totalResponseKeys: totalResponse ? Object.keys(totalResponse).slice(0, 10) : [],
            totalResponseRowsLength: totalResponse?.rows?.length,
            totalResponseRowCount: totalResponse?.rowCount
          });
          
          // Use the responses directly - Promise.all already destructured them
          // totalResponse, pagesResponse, dailyResponse are already the individual response objects
          const actualTotalResponse = totalResponse;
          const actualPagesResponse = pagesResponse;
          const actualDailyResponse = dailyResponse;
          
          // CRITICAL: The log shows the response has data but we're accessing it wrong
          // The stringified response shows: [{rows: [...], rowCount: 1}, null, null]
          // This means Promise.all returned [response1, response2, response3] correctly
          // But when we stringify, it shows the array structure
          // Let's verify the actual structure and extract correctly
          console.log('GA4 pageviews response structure:', {
            totalResponseIsArray: Array.isArray(totalResponse),
            totalResponseType: typeof totalResponse,
            totalResponseHasRows: totalResponse && 'rows' in totalResponse,
            totalResponseHasRowCount: totalResponse && 'rowCount' in totalResponse,
            totalResponseRowCount: totalResponse?.rowCount,
            totalResponseRowsLength: totalResponse?.rows?.length,
            totalResponseFirstRowValue: totalResponse?.rows?.[0]?.metricValues?.[0]?.value,
            pagesResponseRowsLength: pagesResponse?.rows?.length,
            dailyResponseRowsLength: dailyResponse?.rows?.length
          });
          
          // The response from GA4 should be an object with rows and rowCount properties
          // Promise.all already destructured it, so totalResponse IS the response object
          console.log('GA4 pageviews response summary:', {
            totalRows: totalResponse?.rows?.length || 0,
            pagesRows: pagesResponse?.rows?.length || 0,
            dailyRows: dailyResponse?.rows?.length || 0,
            totalValue: totalResponse?.rows?.[0]?.metricValues?.[0]?.value,
            totalRowCount: totalResponse?.rowCount,
            pagesRowCount: pagesResponse?.rowCount,
            dailyRowCount: dailyResponse?.rowCount,
            dateRange: `${startDate} to ${endDate}`,
            property: propertyPath
          });
          
          // CRITICAL: GA4 may return rowCount > 0 but empty rows array
          // If rowCount > 0, we have data even if rows is empty
          if ((actualTotalResponse?.rowCount || 0) > 0 && (!actualTotalResponse?.rows || actualTotalResponse.rows.length === 0)) {
            console.warn('GA4 returned rowCount > 0 but no rows - this is unusual, checking response structure');
            console.warn('Full response structure:', JSON.stringify(actualTotalResponse, null, 2));
          }
          
          // If rowCount is null/undefined but we have rows, log that too
          if ((!actualTotalResponse?.rowCount || actualTotalResponse.rowCount === 0) && actualTotalResponse?.rows && actualTotalResponse.rows.length > 0) {
            console.warn('GA4 returned rows but rowCount is 0 - response structure issue');
          }

        // Extract total - GA4 returns values as strings
        // Based on logs, the response HAS data ("value": "57", "rowCount": 1)
        // The response object should have rows array and rowCount property
        let total = 0;
        
        // Direct access - totalResponse should be the GA4 response object
        if (totalResponse && totalResponse.rows && totalResponse.rows.length > 0) {
          const totalValue = totalResponse.rows[0].metricValues?.[0]?.value;
          total = totalValue ? parseInt(totalValue) : 0;
          console.log('Extracted total from rows:', total, 'from value:', totalValue, 'rowCount:', totalResponse.rowCount);
        } else if (totalResponse && totalResponse.rowCount > 0) {
          // If rowCount > 0 but rows is empty, log it
          console.warn('rowCount > 0 but rows array is empty or undefined', {
            rowCount: totalResponse.rowCount,
            rowsLength: totalResponse.rows?.length,
            hasRows: 'rows' in totalResponse
          });
        } else {
          console.log('No data: rowCount:', totalResponse?.rowCount, 'rows length:', totalResponse?.rows?.length);
        }
        console.log('Final total pageviews:', total);

        // Extract top pages - use pagesResponse directly
        const topPages = (pagesResponse?.rows || []).map(row => {
          const path = row.dimensionValues[0].value || '/';
          const count = parseInt(row.metricValues[0].value || '0');
          return {
            path: normalizePagePath(path),
            count
          };
        });

        // Extract daily data (GA4 returns dates in YYYYMMDD format) - use dailyResponse directly
        const dailyData = (dailyResponse?.rows || []).map(row => {
          const dateStr = row.dimensionValues[0].value || '';
          // Convert YYYYMMDD to YYYY-MM-DD
          const date = dateStr.length === 8 
            ? `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`
            : dateStr;
          const count = parseInt(row.metricValues[0].value || '0');
          return { date, count };
        });

          result = {
            total,
            top_pages: topPages,
            daily: dailyData
          };
        } catch (ga4Error) {
          console.error('GA4 API error in pageviews:', ga4Error);
          console.error('Error details:', {
            message: ga4Error.message,
            code: ga4Error.code,
            status: ga4Error.status
          });
          // Return empty result instead of throwing
          result = {
            total: 0,
            top_pages: [],
            daily: []
          };
        }
        break;
      }

      case 'visitors': {
        if (!analyticsDataClient) {
          console.error('GA4 client not initialized for visitors metric');
          return res.status(503).json({ error: 'GA4 not configured' });
        }

        const { startDate, endDate } = getGA4DateRange(period);
        console.log(`Fetching visitors from GA4: ${startDate} to ${endDate}, Property: ${GA4_PROPERTY_ID}`);

        try {
          const visitorsResponse = await analyticsDataClient.runReport({
            property: `properties/${GA4_PROPERTY_ID}`,
            dateRanges: [{ startDate, endDate }],
            metrics: [
              { name: 'totalUsers' },
              { name: 'newUsers' },
              { name: 'sessions' }
            ],
          });

          console.log('GA4 visitors response:', {
            rowsCount: visitorsResponse.rows?.length || 0,
            firstRow: visitorsResponse.rows?.[0] ? {
              metricValues: visitorsResponse.rows[0].metricValues?.map(m => m.value)
            } : null,
            fullResponse: JSON.stringify(visitorsResponse, null, 2).substring(0, 500)
          });

          const row = visitorsResponse.rows?.[0];
          const totalUsers = row ? parseInt(row.metricValues[0].value || '0') : 0;
          const newUsers = row ? parseInt(row.metricValues[1].value || '0') : 0;
          const totalSessions = row ? parseInt(row.metricValues[2].value || '0') : 0;

          console.log('Extracted visitors:', { totalUsers, newUsers, totalSessions });

          result = {
            unique_visitors: totalUsers,
            new_visitors: newUsers,
            total_sessions: totalSessions
          };
        } catch (ga4Error) {
          console.error('GA4 API error in visitors:', ga4Error);
          console.error('Error details:', {
            message: ga4Error.message,
            code: ga4Error.code,
            status: ga4Error.status
          });
          result = {
            unique_visitors: 0,
            new_visitors: 0,
            total_sessions: 0
          };
        }
        break;
      }

      case 'devices': {
        if (!analyticsDataClient) {
          return res.status(503).json({ error: 'GA4 not configured' });
        }

        const { startDate, endDate } = getGA4DateRange(period);

        const devicesResponse = await analyticsDataClient.runReport({
          property: `properties/${GA4_PROPERTY_ID}`,
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: 'deviceCategory' }],
          metrics: [{ name: 'sessions' }],
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        });

        const devices = (devicesResponse.rows || []).map(row => ({
          type: row.dimensionValues[0].value || 'Unknown',
          count: parseInt(row.metricValues[0].value || '0')
        }));

        result = {
          devices
        };
        break;
      }

      case 'geography': {
        if (!analyticsDataClient) {
          return res.status(503).json({ error: 'GA4 not configured' });
        }

        const { startDate, endDate } = getGA4DateRange(period);

        // Get countries and cities
        const [countriesResponse, citiesResponse] = await Promise.all([
          analyticsDataClient.runReport({
            property: `properties/${GA4_PROPERTY_ID}`,
            dateRanges: [{ startDate, endDate }],
            dimensions: [{ name: 'country' }],
            metrics: [{ name: 'sessions' }],
            orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
            limit: 20,
          }),
          analyticsDataClient.runReport({
            property: `properties/${GA4_PROPERTY_ID}`,
            dateRanges: [{ startDate, endDate }],
            dimensions: [{ name: 'city' }],
            metrics: [{ name: 'sessions' }],
            orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
            limit: 20,
          }),
        ]);

        const countries = (countriesResponse.rows || []).map(row => ({
          country: row.dimensionValues[0].value || 'Unknown',
          count: parseInt(row.metricValues[0].value || '0')
        }));

        const cities = (citiesResponse.rows || []).map(row => ({
          city: row.dimensionValues[0].value || 'Unknown',
          count: parseInt(row.metricValues[0].value || '0')
        }));

        result = {
          countries,
          cities
        };
        break;
      }

      case 'timeonpage': {
        if (!analyticsDataClient) {
          return res.status(503).json({ error: 'GA4 not configured' });
        }

        const { startDate, endDate } = getGA4DateRange(period);

        // Get overall engagement time and per-page data
        const [overallRes, pagesRes] = await Promise.all([
          analyticsDataClient.runReport({
            property: `properties/${GA4_PROPERTY_ID}`,
            dateRanges: [{ startDate, endDate }],
            metrics: [{ name: 'averageSessionDuration' }],
          }),
          analyticsDataClient.runReport({
            property: `properties/${GA4_PROPERTY_ID}`,
            dateRanges: [{ startDate, endDate }],
            dimensions: [{ name: 'pagePath' }],
            metrics: [{ name: 'averageSessionDuration' }],
            orderBys: [{ metric: { metricName: 'averageSessionDuration' }, desc: true }],
            limit: 10,
          }),
        ]);

        // GA4 averageSessionDuration is in seconds
        const overallAvg = overallRes.rows?.[0] 
          ? Math.round(parseFloat(overallRes.rows[0].metricValues[0].value || '0'))
          : 0;

        const byPage = (pagesRes.rows || []).map(row => ({
          path: normalizePagePath(row.dimensionValues[0].value || '/'),
          average: Math.round(parseFloat(row.metricValues[0].value || '0'))
        }));

        result = {
          overall_average: overallAvg,
          by_page: byPage
        };
        break;
      }

      case 'visits': {
        // Recent individual visits with timestamp, country, and returning flag
        // Only show actual page visits (not section tracking or time updates)
        let query = supabase
          .from('page_views')
          .select('created_at, page_path, country, session_id, hashed_ip')
          .not('page_path', 'like', '/section/%') // Exclude section tracking paths
          .order('created_at', { ascending: false })
          .limit(500); // Get more to filter down to unique visits

        if (dateFilter) {
          query = query.gte('created_at', dateFilter);
        }

        if (excludedIPHashes.length > 0) {
          excludedIPHashes.forEach(hash => {
            query = query.neq('hashed_ip', hash);
          });
        }

        const { data: visitsRaw } = await query;

        if (!visitsRaw || visitsRaw.length === 0) {
          result = { visits: [] };
          break;
        }

        // Filter to unique page visits per session (first visit to each page per session)
        // This removes duplicate time updates and shows actual page navigation
        const uniqueVisits = [];
        const seenVisits = new Set(); // Track session_id + normalized path combinations
        
        visitsRaw.forEach(v => {
          const normalizedPath = normalizePagePath(v.page_path || '/');
          const visitKey = `${v.session_id || 'no-session'}:${normalizedPath}`;
          
          // Only include if we haven't seen this session+page combination
          // Take the first (most recent) occurrence since we're ordered DESC
          if (!seenVisits.has(visitKey)) {
            seenVisits.add(visitKey);
            uniqueVisits.push(v);
          }
        });

        // Sort by created_at descending and limit to 200 most recent unique visits
        uniqueVisits.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const finalVisits = uniqueVisits.slice(0, 200);

        // Get session info to determine returning visitors
        const sessionIds = Array.from(new Set(
          finalVisits.map(v => v.session_id).filter(id => !!id)
        ));

        const sessionMap = {};
        if (sessionIds.length > 0) {
          const { data: sessions } = await supabase
            .from('visitor_sessions')
            .select('session_id, country, is_new_visitor')
            .in('session_id', sessionIds);

          if (sessions) {
            sessions.forEach(s => {
              sessionMap[s.session_id] = s;
            });
          }
        }

        // Helper to convert UTC to Central Time (CST/CDT)
        function toCST(date) {
          const utcDate = new Date(date);
          const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Chicago',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
          });
          const parts = formatter.formatToParts(utcDate);
          const year = parseInt(parts.find(p => p.type === 'year').value);
          const month = parseInt(parts.find(p => p.type === 'month').value) - 1;
          const day = parseInt(parts.find(p => p.type === 'day').value);
          const hour = parseInt(parts.find(p => p.type === 'hour').value);
          const minute = parseInt(parts.find(p => p.type === 'minute').value);
          const second = parseInt(parts.find(p => p.type === 'second').value);
          return new Date(year, month, day, hour, minute, second);
        }

        const visits = finalVisits.map(v => {
          const session = v.session_id ? sessionMap[v.session_id] : null;
          const cstDate = v.created_at ? toCST(new Date(v.created_at)) : null;

          let displayTime = 'Unknown';
          let isoTime = null;
          if (cstDate) {
            const year = cstDate.getFullYear();
            const month = String(cstDate.getMonth() + 1).padStart(2, '0');
            const day = String(cstDate.getDate()).padStart(2, '0');
            const hour = String(cstDate.getHours()).padStart(2, '0');
            const minute = String(cstDate.getMinutes()).padStart(2, '0');
            const second = String(cstDate.getSeconds()).padStart(2, '0');
            displayTime = `${year}-${month}-${day} ${hour}:${minute}:${second} CST`;
            isoTime = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
          }

          const normalizedPath = normalizePagePath(v.page_path || '/');
          const visitCountry = v.country || (session && session.country) || 'Unknown';
          const isReturning = session ? !session.is_new_visitor : null;

          return {
            time_iso: isoTime,
            time_display: displayTime,
            path: normalizedPath,
            country: visitCountry,
            is_returning: isReturning
          };
        });

        result = { visits };
        break;
      }

      case 'hourly': {
        // Get page views with timestamps
        // Optional: filter by page_path if provided
        const { page_path } = req.query;
        
        let query = supabase
          .from('page_views')
          .select('created_at');

        if (dateFilter) {
          query = query.gte('created_at', dateFilter);
        }

        // Filter by page path if provided
        if (page_path) {
          query = query.eq('page_path', page_path);
        }

        // Exclude filtered IPs
        if (excludedIPHashes.length > 0) {
          excludedIPHashes.forEach(hash => {
            query = query.neq('hashed_ip', hash);
          });
        }

        const { data: views } = await query;

        // Initialize hour buckets (0-23)
        const hourCounts = {};
        for (let i = 0; i < 24; i++) {
          hourCounts[i] = 0;
        }

        // Group views by hour (converting UTC to CST)
        // CST is UTC-6, CDT (daylight saving) is UTC-5
        if (views) {
          views.forEach(view => {
            if (view.created_at) {
              const date = new Date(view.created_at);
              
              // Convert to CST/CDT timezone
              // Format: 'America/Chicago' handles CST/CDT automatically
              const cstDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
              
              // Get hour in CST
              const hour = cstDate.getHours();
              hourCounts[hour] = (hourCounts[hour] || 0) + 1;
            }
          });
        }

        // Convert to array format for chart
        const hourlyData = Object.entries(hourCounts)
          .map(([hour, count]) => ({
            hour: parseInt(hour),
            count: count
          }))
          .sort((a, b) => a.hour - b.hour);

        result = {
          hourly: hourlyData
        };
        break;
      }

      case 'timeline': {
        if (!analyticsDataClient) {
          return res.status(503).json({ error: 'GA4 not configured' });
        }

        const { month, day } = req.query;
        const { startDate, endDate } = getGA4DateRange(period);

        // Month and day name arrays
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                           'July', 'August', 'September', 'October', 'November', 'December'];
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

        let months = [];
        let days = [];
        let hours = [];
        let dayOfWeekData = [];

        // Get monthly data (always needed for navigation)
        const monthsResponse = await analyticsDataClient.runReport({
          property: `properties/${GA4_PROPERTY_ID}`,
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: 'yearMonth' }],
          metrics: [{ name: 'sessions' }],
          orderBys: [{ dimension: { dimensionName: 'yearMonth' } }],
        });

        months = (monthsResponse.rows || []).map(row => {
          const yearMonth = row.dimensionValues[0].value || '';
          // yearMonth is in YYYYMM format
          const year = yearMonth.substring(0, 4);
          const monthNum = parseInt(yearMonth.substring(4, 6));
          return {
            month: `${year}-${String(monthNum).padStart(2, '0')}`,
            label: `${monthNames[monthNum - 1]} ${year}`,
            count: parseInt(row.metricValues[0].value || '0')
          };
        });

        // Get daily data if month filter is provided
        if (month) {
          // Adjust date range to the specific month
          const monthStart = `${month}-01`;
          const monthEndDate = new Date(month + '-01');
          monthEndDate.setMonth(monthEndDate.getMonth() + 1);
          monthEndDate.setDate(monthEndDate.getDate() - 1);
          const monthEnd = `${month}-${String(monthEndDate.getDate()).padStart(2, '0')}`;

          const daysResponse = await analyticsDataClient.runReport({
            property: `properties/${GA4_PROPERTY_ID}`,
            dateRanges: [{ startDate: monthStart, endDate: monthEnd }],
            dimensions: [{ name: 'date' }],
            metrics: [{ name: 'sessions' }],
            orderBys: [{ dimension: { dimensionName: 'date' } }],
          });

          days = (daysResponse.rows || []).map(row => {
            const dateStr = row.dimensionValues[0].value || '';
            // date is in YYYYMMDD format
            const year = dateStr.substring(0, 4);
            const monthNum = parseInt(dateStr.substring(4, 6));
            const dayNum = parseInt(dateStr.substring(6, 8));
            const date = new Date(year, monthNum - 1, dayNum);
            return {
              day: `${year}-${String(monthNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`,
              label: `${monthNames[monthNum - 1]} ${dayNum}, ${year} (${dayNames[date.getDay()]})`,
              count: parseInt(row.metricValues[0].value || '0')
            };
          });
        }

        // Get hourly data if day filter is provided
        if (day) {
          const hoursResponse = await analyticsDataClient.runReport({
            property: `properties/${GA4_PROPERTY_ID}`,
            dateRanges: [{ startDate: day, endDate: day }],
            dimensions: [{ name: 'hour' }],
            metrics: [{ name: 'sessions' }],
            orderBys: [{ dimension: { dimensionName: 'hour' } }],
          });

          const hourMap = {};
          (hoursResponse.rows || []).forEach(row => {
            const hour = parseInt(row.dimensionValues[0].value || '0');
            hourMap[hour] = parseInt(row.metricValues[0].value || '0');
          });

          // Create array for all 24 hours
          for (let i = 0; i < 24; i++) {
            const period = i >= 12 ? 'PM' : 'AM';
            const displayHour = i === 0 ? 12 : i > 12 ? i - 12 : i;
            hours.push({
              hour: i,
              label: `${displayHour} ${period}`,
              count: hourMap[i] || 0
            });
          }
        }

        // Get day of week data (only if not filtering by day)
        if (!day) {
          const dayOfWeekResponse = await analyticsDataClient.runReport({
            property: `properties/${GA4_PROPERTY_ID}`,
            dateRanges: [{ startDate, endDate }],
            dimensions: [{ name: 'dayOfWeek' }],
            metrics: [{ name: 'sessions' }],
            orderBys: [{ dimension: { dimensionName: 'dayOfWeek' } }],
          });

          const dayOfWeekMap = {
            'SUNDAY': 'Sunday',
            'MONDAY': 'Monday',
            'TUESDAY': 'Tuesday',
            'WEDNESDAY': 'Wednesday',
            'THURSDAY': 'Thursday',
            'FRIDAY': 'Friday',
            'SATURDAY': 'Saturday'
          };

          const dayOfWeekCounts = {
            'Sunday': 0,
            'Monday': 0,
            'Tuesday': 0,
            'Wednesday': 0,
            'Thursday': 0,
            'Friday': 0,
            'Saturday': 0
          };

          (dayOfWeekResponse.rows || []).forEach(row => {
            const ga4Day = row.dimensionValues[0].value || '';
            const dayName = dayOfWeekMap[ga4Day] || ga4Day;
            if (dayOfWeekCounts[dayName] !== undefined) {
              dayOfWeekCounts[dayName] = parseInt(row.metricValues[0].value || '0');
            }
          });

          dayOfWeekData = Object.entries(dayOfWeekCounts)
            .map(([day, count]) => ({ day, count }))
            .sort((a, b) => {
              const order = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
              return order.indexOf(a.day) - order.indexOf(b.day);
            });
        }

        // Identify peak times
        const peakHour = hours.length > 0
          ? hours.reduce((max, h) => h.count > max.count ? h : max, hours[0])
          : null;
        const peakDay = dayOfWeekData.length > 0
          ? dayOfWeekData.reduce((max, d) => d.count > max.count ? d : max, dayOfWeekData[0])
          : null;

        result = {
          months: months,
          days: days,
          hours: hours,
          day_of_week: dayOfWeekData,
          peak_hour: peakHour ? { hour: peakHour.hour, label: peakHour.label, count: peakHour.count } : null,
          peak_day: peakDay ? { day: peakDay.day, count: peakDay.count } : null
        };
        break;
      }

      case 'growth': {
        if (!analyticsDataClient) {
          return res.status(503).json({ error: 'GA4 not configured' });
        }

        // Compare current period to previous period for growth metrics
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const formatDate = (date) => {
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
        };

        let currentStart, currentEnd, previousStart, previousEnd;
        
        if (period === '7d') {
          currentEnd = formatDate(today);
          const currentStartDate = new Date(today);
          currentStartDate.setDate(currentStartDate.getDate() - 6);
          currentStart = formatDate(currentStartDate);
          
          const previousEndDate = new Date(currentStartDate);
          previousEndDate.setDate(previousEndDate.getDate() - 1);
          previousEnd = formatDate(previousEndDate);
          const previousStartDate = new Date(previousEndDate);
          previousStartDate.setDate(previousStartDate.getDate() - 6);
          previousStart = formatDate(previousStartDate);
        } else if (period === '30d') {
          currentEnd = formatDate(today);
          const currentStartDate = new Date(today);
          currentStartDate.setDate(currentStartDate.getDate() - 29);
          currentStart = formatDate(currentStartDate);
          
          const previousEndDate = new Date(currentStartDate);
          previousEndDate.setDate(previousEndDate.getDate() - 1);
          previousEnd = formatDate(previousEndDate);
          const previousStartDate = new Date(previousEndDate);
          previousStartDate.setDate(previousStartDate.getDate() - 29);
          previousStart = formatDate(previousStartDate);
        } else {
          // For 'all', compare last 30 days to previous 30 days
          currentEnd = formatDate(today);
          const currentStartDate = new Date(today);
          currentStartDate.setDate(currentStartDate.getDate() - 29);
          currentStart = formatDate(currentStartDate);
          
          const previousEndDate = new Date(currentStartDate);
          previousEndDate.setDate(previousEndDate.getDate() - 1);
          previousEnd = formatDate(previousEndDate);
          const previousStartDate = new Date(previousEndDate);
          previousStartDate.setDate(previousStartDate.getDate() - 29);
          previousStart = formatDate(previousStartDate);
        }

        // Get current and previous period data from GA4
        const [currentRes, previousRes] = await Promise.all([
          analyticsDataClient.runReport({
            property: `properties/${GA4_PROPERTY_ID}`,
            dateRanges: [{ startDate: currentStart, endDate: currentEnd }],
            metrics: [
              { name: 'screenPageViews' },
              { name: 'totalUsers' },
              { name: 'averageSessionDuration' }
            ],
          }),
          analyticsDataClient.runReport({
            property: `properties/${GA4_PROPERTY_ID}`,
            dateRanges: [{ startDate: previousStart, endDate: previousEnd }],
            metrics: [
              { name: 'screenPageViews' },
              { name: 'totalUsers' },
              { name: 'averageSessionDuration' }
            ],
          }),
        ]);

        const currentRow = currentRes.rows?.[0];
        const previousRow = previousRes.rows?.[0];

        const currentPageviews = currentRow ? parseInt(currentRow.metricValues[0].value || '0') : 0;
        const previousPageviews = previousRow ? parseInt(previousRow.metricValues[0].value || '0') : 0;
        
        const currentUniqueVisitors = currentRow ? parseInt(currentRow.metricValues[1].value || '0') : 0;
        const previousUniqueVisitors = previousRow ? parseInt(previousRow.metricValues[1].value || '0') : 0;
        
        // GA4 averageSessionDuration is in seconds, convert to seconds for consistency
        const currentAvgTime = currentRow ? Math.round(parseFloat(currentRow.metricValues[2].value || '0')) : 0;
        const previousAvgTime = previousRow ? Math.round(parseFloat(previousRow.metricValues[2].value || '0')) : 0;

        // Calculate percentage changes
        const pageviewsChange = previousPageviews > 0
          ? Math.round(((currentPageviews - previousPageviews) / previousPageviews) * 100)
          : (currentPageviews > 0 ? 100 : 0);
        
        const visitorsChange = previousUniqueVisitors > 0
          ? Math.round(((currentUniqueVisitors - previousUniqueVisitors) / previousUniqueVisitors) * 100)
          : (currentUniqueVisitors > 0 ? 100 : 0);
        
        const timeChange = previousAvgTime > 0
          ? Math.round(((currentAvgTime - previousAvgTime) / previousAvgTime) * 100)
          : (currentAvgTime > 0 ? 100 : 0);

        result = {
          pageviews: {
            current: currentPageviews,
            previous: previousPageviews,
            change: pageviewsChange,
            trend: pageviewsChange > 0 ? 'up' : pageviewsChange < 0 ? 'down' : 'stable'
          },
          visitors: {
            current: currentUniqueVisitors,
            previous: previousUniqueVisitors,
            change: visitorsChange,
            trend: visitorsChange > 0 ? 'up' : visitorsChange < 0 ? 'down' : 'stable'
          },
          time_on_page: {
            current: currentAvgTime,
            previous: previousAvgTime,
            change: timeChange,
            trend: timeChange > 0 ? 'up' : timeChange < 0 ? 'down' : 'stable'
          }
        };
        break;
      }

      case 'engagement': {
        if (!analyticsDataClient) {
          return res.status(503).json({ error: 'GA4 not configured' });
        }

        const { startDate, endDate } = getGA4DateRange(period);

        // Get engagement metrics from GA4
        const [engagementRes, usersRes] = await Promise.all([
          analyticsDataClient.runReport({
            property: `properties/${GA4_PROPERTY_ID}`,
            dateRanges: [{ startDate, endDate }],
            metrics: [
              { name: 'bounceRate' },
              { name: 'averageSessionDuration' },
              { name: 'sessions' },
              { name: 'screenPageViews' }
            ],
          }),
          analyticsDataClient.runReport({
            property: `properties/${GA4_PROPERTY_ID}`,
            dateRanges: [{ startDate, endDate }],
            metrics: [
              { name: 'newUsers' },
              { name: 'totalUsers' }
            ],
          }),
        ]);

        const row = engagementRes.rows?.[0];
        const usersRow = usersRes.rows?.[0];

        const bounceRate = row ? Math.round(parseFloat(row.metricValues[0].value || '0') * 100) : 0;
        const avgSessionDuration = row ? Math.round(parseFloat(row.metricValues[1].value || '0')) : 0;
        const totalSessions = row ? parseInt(row.metricValues[2].value || '0') : 0;
        const totalPageViews = row ? parseInt(row.metricValues[3].value || '0') : 0;
        const avgPagesPerSession = totalSessions > 0 
          ? Math.round((totalPageViews / totalSessions) * 10) / 10 
          : 0;

        const newUsers = usersRow ? parseInt(usersRow.metricValues[0].value || '0') : 0;
        const totalUsers = usersRow ? parseInt(usersRow.metricValues[1].value || '0') : 0;
        const returningVisitors = totalUsers - newUsers;
        const returnRate = totalUsers > 0 
          ? Math.round((returningVisitors / totalUsers) * 100) 
          : 0;

        // Approximate pages per session distribution based on average
        // GA4 doesn't provide individual session data, so we estimate
        const pagesDistribution = {
          '1': Math.round(totalSessions * (avgPagesPerSession < 1.5 ? 0.6 : 0.3)),
          '2-3': Math.round(totalSessions * (avgPagesPerSession >= 1.5 && avgPagesPerSession < 3.5 ? 0.5 : 0.4)),
          '4-5': Math.round(totalSessions * (avgPagesPerSession >= 3.5 && avgPagesPerSession < 5.5 ? 0.4 : 0.2)),
          '6+': Math.round(totalSessions * (avgPagesPerSession >= 5.5 ? 0.3 : 0.1))
        };

        // Approximate time distribution based on average session duration
        // GA4 doesn't provide per-session time buckets, so we estimate
        const timeDistribution = {
          '0-30s': Math.round(totalSessions * (avgSessionDuration < 30 ? 0.4 : 0.1)),
          '30s-1min': Math.round(totalSessions * (avgSessionDuration >= 30 && avgSessionDuration < 60 ? 0.3 : 0.2)),
          '1-2min': Math.round(totalSessions * (avgSessionDuration >= 60 && avgSessionDuration < 120 ? 0.3 : 0.2)),
          '2-5min': Math.round(totalSessions * (avgSessionDuration >= 120 && avgSessionDuration < 300 ? 0.3 : 0.2)),
          '5min+': Math.round(totalSessions * (avgSessionDuration >= 300 ? 0.4 : 0.1))
        };

        result = {
          bounce_rate: bounceRate,
          pages_per_session: {
            average: avgPagesPerSession,
            distribution: pagesDistribution
          },
          session_duration: {
            average: avgSessionDuration,
            total_sessions: totalSessions
          },
          return_rate: returnRate,
          new_visitors: newUsers,
          returning_visitors: returningVisitors,
          time_distribution: timeDistribution
        };
        break;
      }

      case 'sources': {
        if (!analyticsDataClient) {
          return res.status(503).json({ error: 'GA4 not configured' });
        }

        const { startDate, endDate } = getGA4DateRange(period);

        // Get traffic sources with session source and medium
        const sourcesResponse = await analyticsDataClient.runReport({
          property: `properties/${GA4_PROPERTY_ID}`,
          dateRanges: [{ startDate, endDate }],
          dimensions: [
            { name: 'sessionSource' },
            { name: 'sessionMedium' }
          ],
          metrics: [
            { name: 'sessions' },
            { name: 'bounceRate' },
            { name: 'averageSessionDuration' }
          ],
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: 100,
        });

        const categories = {
          'Direct': { count: 0, sessions: 0, bounce_rate: 0, avg_time: 0 },
          'Search': { count: 0, sessions: 0, bounce_rate: 0, avg_time: 0 },
          'Social': { count: 0, sessions: 0, bounce_rate: 0, avg_time: 0 },
          'Other': { count: 0, sessions: 0, bounce_rate: 0, avg_time: 0 }
        };

        const referrerMap = {};
        const searchEngines = {
          'Google': 0,
          'Bing': 0,
          'DuckDuckGo': 0,
          'Yahoo': 0,
          'Other': 0
        };

        const searchDomains = {
          'google': 'Google',
          'bing': 'Bing',
          'duckduckgo': 'DuckDuckGo',
          'yahoo': 'Yahoo',
          'yandex': 'Yandex'
        };

        const socialDomains = ['x.com', 'twitter.com', 'facebook.com', 'instagram.com', 'linkedin.com', 'reddit.com', 'tiktok.com'];

        let totalSessions = 0;

        (sourcesResponse.rows || []).forEach(row => {
          const source = row.dimensionValues[0].value || '';
          const medium = row.dimensionValues[1].value || '';
          const sessions = parseInt(row.metricValues[0].value || '0');
          const bounceRate = parseFloat(row.metricValues[1].value || '0');
          const avgDuration = parseFloat(row.metricValues[2].value || '0');

          totalSessions += sessions;

          let category = 'Direct';
          let searchEngine = null;

          const sourceLower = source.toLowerCase();

          // Check if it's a search engine
          for (const [searchKey, engineName] of Object.entries(searchDomains)) {
            if (sourceLower.includes(searchKey)) {
              category = 'Search';
              searchEngine = engineName;
              break;
            }
          }

          // Check if it's social media (especially X.com)
          if (category === 'Direct' && (sourceLower.includes('x.com') || sourceLower.includes('twitter.com'))) {
            category = 'Social';
          } else if (category === 'Direct' && socialDomains.some(social => sourceLower.includes(social))) {
            category = 'Social';
          }

          // If not search or social and has a source, it's "Other"
          if (category === 'Direct' && source && !sourceLower.includes('watchmanscry.site') && !sourceLower.includes('localhost')) {
            category = 'Other';
          }

          // Aggregate by category
          categories[category].count++;
          categories[category].sessions += sessions;
          categories[category].bounce_rate += bounceRate * sessions;
          categories[category].avg_time += avgDuration * sessions;

          // Track individual referrers (especially X.com)
          if (source && category !== 'Direct') {
            if (!referrerMap[source]) {
              referrerMap[source] = {
                domain: source,
                count: 0,
                sessions: 0,
                bounce_rate: 0,
                avg_time: 0,
                category: category
              };
            }
            referrerMap[source].count++;
            referrerMap[source].sessions += sessions;
            referrerMap[source].bounce_rate += bounceRate * sessions;
            referrerMap[source].avg_time += avgDuration * sessions;
          }

          // Track search engines
          if (searchEngine) {
            if (searchEngines[searchEngine] !== undefined) {
              searchEngines[searchEngine] += sessions;
            } else {
              searchEngines['Other'] += sessions;
            }
          }
        });

        // Calculate averages for categories
        const categoryData = Object.entries(categories).map(([name, data]) => ({
          name: name,
          count: data.count,
          sessions: data.sessions,
          percentage: totalSessions > 0 ? Math.round((data.sessions / totalSessions) * 100) : 0,
          bounce_rate: data.sessions > 0 ? Math.round((data.bounce_rate / data.sessions) * 100) : 0,
          avg_time: data.sessions > 0 ? Math.round(data.avg_time / data.sessions) : 0
        }));

        // Calculate metrics for top referrers (highlight X.com)
        const topReferrers = Object.values(referrerMap)
          .map(ref => ({
            domain: ref.domain,
            count: ref.count,
            sessions: ref.sessions,
            bounce_rate: ref.sessions > 0 ? Math.round((ref.bounce_rate / ref.sessions) * 100) : 0,
            avg_time: ref.sessions > 0 ? Math.round(ref.avg_time / ref.sessions) : 0,
            category: ref.category,
            isXcom: ref.domain.toLowerCase().includes('x.com') || ref.domain.toLowerCase().includes('twitter.com')
          }))
          .sort((a, b) => b.sessions - a.sessions)
          .slice(0, 10);

        // Format search engines
        const searchEngineData = Object.entries(searchEngines)
          .filter(([_, count]) => count > 0)
          .map(([name, count]) => ({
            name: name,
            count: count
          }))
          .sort((a, b) => b.count - a.count);

        result = {
          categories: categoryData,
          top_referrers: topReferrers,
          search_engines: searchEngineData,
          xcom_traffic: topReferrers.find(r => r.isXcom) || { sessions: 0, percentage: 0 }
        };
        break;
      }

      case 'content': {
        if (!analyticsDataClient) {
          return res.status(503).json({ error: 'GA4 not configured' });
        }

        const { startDate, endDate } = getGA4DateRange(period);

        // Get page performance data from GA4
        const pagesResponse = await analyticsDataClient.runReport({
          property: `properties/${GA4_PROPERTY_ID}`,
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: 'pagePath' }],
          metrics: [
            { name: 'screenPageViews' },
            { name: 'bounceRate' },
            { name: 'averageSessionDuration' }
          ],
          orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
          limit: 50,
        });

        const pagePerformance = (pagesResponse.rows || []).map(row => {
          const path = normalizePagePath(row.dimensionValues[0].value || '/');
          const views = parseInt(row.metricValues[0].value || '0');
          const bounceRate = Math.round(parseFloat(row.metricValues[1].value || '0') * 100);
          const avgTime = Math.round(parseFloat(row.metricValues[2].value || '0')); // Session duration in seconds

          // Engagement score: weighted combination
          const engagementScore = Math.round(
            (views * 0.3) + // Views weight
            ((100 - bounceRate) * 0.4) + // Low bounce rate weight
            (Math.min(avgTime / 10, 10) * 0.3) // Time weight (capped at 10 points for 100+ seconds)
          );

          return {
            path,
            views,
            avg_time: avgTime,
            bounce_rate: bounceRate,
            engagement_score: engagementScore
          };
        });

        // Sort by engagement score
        pagePerformance.sort((a, b) => b.engagement_score - a.engagement_score);

        // Filter and calculate edition performance
        const editions = [];
        const editionMap = {};
        
        pagePerformance.forEach(page => {
          if (page.path.includes('/archive/') || page.path.includes('edition-') || page.path.includes('index-')) {
            const editionMatch = page.path.match(/(\d{4}-\d{2}-\d{2})/);
            if (editionMatch) {
              const editionDate = editionMatch[1];
              if (!editionMap[editionDate]) {
                editionMap[editionDate] = {
                  date: editionDate,
                  views: 0,
                  avg_time: 0,
                  bounce_rate: 0,
                  count: 0
                };
              }
              editionMap[editionDate].views += page.views;
              editionMap[editionDate].avg_time += page.avg_time;
              editionMap[editionDate].bounce_rate += page.bounce_rate;
              editionMap[editionDate].count++;
            }
          }
        });

        const editionPerformance = Object.values(editionMap).map(edition => ({
          date: edition.date,
          views: edition.views,
          avg_time: Math.round(edition.avg_time / edition.count),
          bounce_rate: Math.round(edition.bounce_rate / edition.count),
          engagement_score: Math.round(
            (edition.views * 0.3) +
            ((100 - Math.round(edition.bounce_rate / edition.count)) * 0.4) +
            (Math.min(Math.round(edition.avg_time / edition.count) / 10, 10) * 0.3)
          )
        })).sort((a, b) => b.engagement_score - a.engagement_score);

        // Screen time data (using session duration as approximation)
        const screenTimeData = pagePerformance.map(page => ({
          path: page.path,
          total_screen_time: page.views * page.avg_time, // Approximate total time
          avg_screen_time: page.avg_time,
          views: page.views
        })).sort((a, b) => b.total_screen_time - a.total_screen_time);

        // Get section view time from Supabase (custom tracking - not available in GA4)
        // This is the only metric that still uses Supabase due to custom section tracking
        let sectionTimeData = [];
        try {
          let sectionQuery = supabase
            .from('page_views')
            .select('page_path, time_on_page')
            .like('page_path', '/section/%');

          if (dateFilter) {
            sectionQuery = sectionQuery.gte('created_at', dateFilter);
          }

          const { data: sectionViews } = await sectionQuery;

          if (sectionViews && sectionViews.length > 0) {
            const sectionStats = {};
            sectionViews.forEach(view => {
              const path = view.page_path || '';
              if (!sectionStats[path]) {
                sectionStats[path] = { total: 0, count: 0 };
              }
              if (view.time_on_page) {
                sectionStats[path].total += view.time_on_page;
                sectionStats[path].count++;
              }
            });

            sectionTimeData = Object.entries(sectionStats).map(([path, data]) => ({
              path: path,
              total_screen_time: data.total,
              avg_screen_time: data.count > 0 ? Math.round(data.total / data.count) : 0,
              views: data.count
            })).sort((a, b) => b.total_screen_time - a.total_screen_time);
          }
        } catch (error) {
          console.error('Error fetching section time from Supabase:', error);
          // Continue without section time data
        }

        // Combine GA4 screen time with Supabase section time
        const allScreenTime = [...screenTimeData, ...sectionTimeData];

        result = {
          top_pages: pagePerformance.slice(0, 15),
          editions: editionPerformance,
          engagement_rankings: pagePerformance.slice(0, 10),
          screen_time: allScreenTime
        };
        break;
      }

      case 'journey': {
        if (!analyticsDataClient) {
          return res.status(503).json({ error: 'GA4 not configured' });
        }

        const { startDate, endDate } = getGA4DateRange(period);

        // Get entry pages (landing pages) and page views for exit rate calculation
        const [entryRes, pagesRes] = await Promise.all([
          analyticsDataClient.runReport({
            property: `properties/${GA4_PROPERTY_ID}`,
            dateRanges: [{ startDate, endDate }],
            dimensions: [{ name: 'landingPage' }],
            metrics: [{ name: 'sessions' }],
            orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
            limit: 10,
          }),
          analyticsDataClient.runReport({
            property: `properties/${GA4_PROPERTY_ID}`,
            dateRanges: [{ startDate, endDate }],
            dimensions: [{ name: 'pagePath' }],
            metrics: [{ name: 'screenPageViews' }],
            orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
            limit: 20,
          }),
        ]);

        const totalSessions = entryRes.rows?.reduce((sum, row) => 
          sum + parseInt(row.metricValues[0].value || '0'), 0) || 0;

        // Format entry pages
        const entryPagesData = (entryRes.rows || []).map(row => ({
          path: normalizePagePath(row.dimensionValues[0].value || '/'),
          count: parseInt(row.metricValues[0].value || '0'),
          percentage: totalSessions > 0 
            ? Math.round((parseInt(row.metricValues[0].value || '0') / totalSessions) * 100) 
            : 0
        }));

        // For exit pages, GA4 doesn't provide direct exit page data in Reporting API
        // We'll approximate by using page views and assuming last page viewed = exit
        // This is a limitation - GA4 Reporting API doesn't have exit page dimension
        const pageViewCounts = {};
        (pagesRes.rows || []).forEach(row => {
          const path = normalizePagePath(row.dimensionValues[0].value || '/');
          pageViewCounts[path] = parseInt(row.metricValues[0].value || '0');
        });

        // Approximate exit pages (top pages by views, assuming they're also exit pages)
        const exitPagesData = Object.entries(pageViewCounts)
          .map(([path, views]) => ({
            path,
            count: Math.round(views * 0.3), // Approximate 30% of views are exits
            percentage: totalSessions > 0 
              ? Math.round((Math.round(views * 0.3) / totalSessions) * 100) 
              : 0
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);

        // Calculate exit rates
        const exitRates = exitPagesData.map(exit => ({
          path: exit.path,
          exits: exit.count,
          total_views: pageViewCounts[exit.path] || 0,
          exit_rate: pageViewCounts[exit.path] > 0
            ? Math.round((exit.count / pageViewCounts[exit.path]) * 100)
            : 0
        }));

        result = {
          entry_pages: entryPagesData,
          exit_pages: exitPagesData,
          exit_rates: exitRates.sort((a, b) => b.exit_rate - a.exit_rate)
        };
        break;
      }

      case 'demographics': {
        if (!analyticsDataClient) {
          console.error('GA4 client not initialized for demographics metric');
          return res.status(503).json({ error: 'GA4 not configured' });
        }

        const { startDate, endDate } = getGA4DateRange(period);
        console.log(`Fetching demographics from GA4: ${startDate} to ${endDate}`);

        try {
          // Get age, gender, and interests
          // Note: Demographics may not be available if there's insufficient data or if not enabled
          const [ageResponse, genderResponse, interestsResponse] = await Promise.all([
            analyticsDataClient.runReport({
              property: `properties/${GA4_PROPERTY_ID}`,
              dateRanges: [{ startDate, endDate }],
              dimensions: [{ name: 'userAgeBracket' }],
              metrics: [{ name: 'totalUsers' }],
              orderBys: [{ metric: { metricName: 'totalUsers' }, desc: true }],
            }).catch(err => {
              console.warn('GA4 age bracket query failed:', err.message);
              return { rows: [] };
            }),
            analyticsDataClient.runReport({
              property: `properties/${GA4_PROPERTY_ID}`,
              dateRanges: [{ startDate, endDate }],
              dimensions: [{ name: 'userGender' }],
              metrics: [{ name: 'totalUsers' }],
              orderBys: [{ metric: { metricName: 'totalUsers' }, desc: true }],
            }).catch(err => {
              console.warn('GA4 gender query failed:', err.message);
              return { rows: [] };
            }),
            analyticsDataClient.runReport({
              property: `properties/${GA4_PROPERTY_ID}`,
              dateRanges: [{ startDate, endDate }],
              dimensions: [{ name: 'userInterestCategory' }],
              metrics: [{ name: 'totalUsers' }],
              orderBys: [{ metric: { metricName: 'totalUsers' }, desc: true }],
              limit: 10,
            }).catch(err => {
              console.warn('GA4 interests query failed:', err.message);
              return { rows: [] };
            }),
          ]);

          const age = (ageResponse.rows || []).map(row => ({
            age: row.dimensionValues[0].value || 'Unknown',
            count: parseInt(row.metricValues[0].value || '0')
          }));

          const gender = (genderResponse.rows || []).map(row => ({
            gender: row.dimensionValues[0].value || 'Unknown',
            count: parseInt(row.metricValues[0].value || '0')
          }));

          const interests = (interestsResponse.rows || []).map(row => ({
            interest: row.dimensionValues[0].value || 'Unknown',
            count: parseInt(row.metricValues[0].value || '0')
          }));

          result = {
            age,
            gender,
            interests
          };
        } catch (ga4Error) {
          console.error('GA4 API error in demographics:', ga4Error);
          console.error('Error details:', {
            message: ga4Error.message,
            code: ga4Error.code,
            status: ga4Error.status
          });
          // Return empty demographics instead of throwing
          result = {
            age: [],
            gender: [],
            interests: []
          };
        }
        break;
      }

      default:
        return res.status(400).json({ error: 'Invalid metric' });
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error('Analytics data error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      metric: req.query.metric,
      period: req.query.period,
      ga4Configured: !!analyticsDataClient,
      ga4PropertyId: GA4_PROPERTY_ID
    });
    return res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
