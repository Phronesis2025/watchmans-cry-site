// Vercel Serverless Function: Analytics Tracking Endpoint
// Receives tracking data from client, processes it, and stores in Supabase

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ikksmrbqrirvenqlylxo.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlra3NtcmJxcmlydmVucWx5bHhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODI5ODgsImV4cCI6MjA4Mzc1ODk4OH0.1pKE6_LFTii8R-xY8WvWlXR23mXW3sUpPpKniL9fFvc';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Hash IP address with SHA-256
function hashIP(ip) {
  return crypto.createHash('sha256').update(ip).digest('hex');
}

// Extract IP address from request
function getIPAddress(req) {
  // Check various headers for IP (Vercel, Cloudflare, etc.)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  
  const realIP = req.headers['x-real-ip'];
  if (realIP) {
    return realIP;
  }
  
  const cfIP = req.headers['cf-connecting-ip'];
  if (cfIP) {
    return cfIP;
  }
  
  return req.headers['x-vercel-forwarded-for'] || 'unknown';
}

// Parse user agent to extract device type, browser, and OS
function parseUserAgent(userAgent) {
  if (!userAgent) {
    return { device_type: 'desktop', browser: null, os: null };
  }

  const ua = userAgent.toLowerCase();
  
  // Device type detection
  let deviceType = 'desktop';
  if (/mobile|android|iphone|ipod|blackberry|iemobile|opera mini/i.test(ua)) {
    deviceType = 'mobile';
  } else if (/tablet|ipad|playbook|silk/i.test(ua)) {
    deviceType = 'tablet';
  }

  // Browser detection
  let browser = null;
  if (ua.includes('chrome') && !ua.includes('edg')) {
    browser = 'Chrome';
  } else if (ua.includes('firefox')) {
    browser = 'Firefox';
  } else if (ua.includes('safari') && !ua.includes('chrome')) {
    browser = 'Safari';
  } else if (ua.includes('edg')) {
    browser = 'Edge';
  } else if (ua.includes('opera') || ua.includes('opr')) {
    browser = 'Opera';
  } else if (ua.includes('msie') || ua.includes('trident')) {
    browser = 'Internet Explorer';
  }

  // OS detection
  let os = null;
  if (ua.includes('windows')) {
    os = 'Windows';
  } else if (ua.includes('mac os') || ua.includes('macos')) {
    os = 'macOS';
  } else if (ua.includes('linux') && !ua.includes('android')) {
    os = 'Linux';
  } else if (ua.includes('android')) {
    os = 'Android';
  } else if (ua.includes('ios') || ua.includes('iphone') || ua.includes('ipad')) {
    os = 'iOS';
  }

  return { device_type: deviceType, browser, os };
}

// Extract domain from referrer URL
function extractDomain(referrer) {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    return url.hostname;
  } catch (e) {
    return null;
  }
}

// Get country from IP using free geolocation API
async function getCountryFromIP(ip) {
  // First try Vercel header
  // Note: This would need to be passed from the request, but Vercel doesn't expose it in serverless functions
  // So we'll use the API
  
  // Try ipapi.co (free tier: 1000 requests/day)
  try {
    const response = await fetch(`https://ipapi.co/${ip}/country/`, {
      headers: {
        'User-Agent': 'WatchmansCry/1.0'
      }
    });
    
    if (response.ok) {
      const country = await response.text();
      if (country && country.length === 2) {
        return country.trim();
      }
    }
  } catch (e) {
    // Fallback to next service
  }

  // Fallback to ip-api.com (free tier: 45 requests/minute)
  try {
    const response = await fetch(`http://ip-api.com/json/${ip}?fields=countryCode`, {
      headers: {
        'User-Agent': 'WatchmansCry/1.0'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data && data.countryCode) {
        return data.countryCode;
      }
    }
  } catch (e) {
    // Return null if both fail
  }

  return null;
}

// Check and update rate limits
async function checkRateLimit(hashedIP) {
  const now = new Date();
  const oneMinuteAgo = new Date(now.getTime() - 60000);

  // Get existing rate limit record
  const { data: existing } = await supabase
    .from('rate_limits')
    .select('*')
    .eq('hashed_ip', hashedIP)
    .single();

  if (existing) {
    const windowStart = new Date(existing.window_start);
    
    // If window has expired, reset
    if (windowStart < oneMinuteAgo) {
      await supabase
        .from('rate_limits')
        .update({
          request_count: 1,
          window_start: now,
          updated_at: now
        })
        .eq('hashed_ip', hashedIP);
      return true;
    }
    
    // Check if limit exceeded
    if (existing.request_count >= 10) {
      return false; // Rate limit exceeded
    }
    
    // Increment count
    await supabase
      .from('rate_limits')
      .update({
        request_count: existing.request_count + 1,
        updated_at: now
      })
      .eq('hashed_ip', hashedIP);
    return true;
  } else {
    // Create new rate limit record
    await supabase
      .from('rate_limits')
      .insert({
        hashed_ip: hashedIP,
        request_count: 1,
        window_start: now
      });
    return true;
  }
}

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // CORS headers - allow requests from your domain
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
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Parse request body
    // Handle both JSON and Blob (from sendBeacon)
    let body;
    if (req.body instanceof Buffer || (typeof req.body === 'string' && req.body.length > 0)) {
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : JSON.parse(req.body.toString());
      } catch (e) {
        // If parsing fails, try to handle as Blob/FormData
        return res.status(400).json({ error: 'Invalid request body' });
      }
    } else if (typeof req.body === 'object' && req.body !== null) {
      body = req.body;
    } else {
      return res.status(400).json({ error: 'Missing request body' });
    }
    
    // Validate required fields
    if (!body.page_path || !body.session_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Extract and hash IP
    const ip = getIPAddress(req);
    if (ip === 'unknown') {
      return res.status(400).json({ error: 'Could not determine IP address' });
    }
    const hashedIP = hashIP(ip);

    // Check rate limit
    const rateLimitOk = await checkRateLimit(hashedIP);
    if (!rateLimitOk) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }

    // Parse user agent
    const { device_type, browser, os } = parseUserAgent(body.user_agent);

    // Extract referrer domain
    const referrerDomain = extractDomain(body.referrer);

    // Get country (async, but we'll proceed even if it fails)
    let country = null;
    try {
      country = await getCountryFromIP(ip);
    } catch (e) {
      // Continue without country if geolocation fails
      console.error('Geolocation error:', e);
    }

    // Determine if this is a bounce (single page view in session)
    // We'll check this after inserting the page view

    // Insert page view
    const pageViewData = {
      page_path: body.page_path.substring(0, 500), // Limit length
      page_title: body.page_title ? body.page_title.substring(0, 500) : null,
      referrer: body.referrer ? body.referrer.substring(0, 1000) : null,
      referrer_domain: referrerDomain ? referrerDomain.substring(0, 255) : null,
      user_agent: body.user_agent ? body.user_agent.substring(0, 500) : null,
      hashed_ip: hashedIP,
      country: country,
      device_type: device_type,
      browser: browser,
      os: os,
      time_on_page: body.time_on_page || null,
      session_id: body.session_id.substring(0, 100) // Limit length
    };

    // If this is just a time update, update existing record instead of creating new one
    if (body.is_update && !body.is_final) {
      // For periodic updates, we could update the latest page view for this session
      // For simplicity, we'll just insert a new record with the updated time
      // This allows tracking time progression
    }

    const { error: pageViewError } = await supabase
      .from('page_views')
      .insert(pageViewData);

    if (pageViewError) {
      console.error('Error inserting page view:', pageViewError);
      return res.status(500).json({ error: 'Failed to store page view' });
    }

    // Update or create visitor session
    const { data: existingSession } = await supabase
      .from('visitor_sessions')
      .select('*')
      .eq('session_id', body.session_id)
      .single();

    if (existingSession) {
      // Update existing session
      await supabase
        .from('visitor_sessions')
        .update({
          last_visit_at: new Date().toISOString(),
          page_count: existingSession.page_count + 1,
          updated_at: new Date().toISOString()
        })
        .eq('session_id', body.session_id);
    } else {
      // Check if this IP has been seen before
      const { data: previousVisits } = await supabase
        .from('visitor_sessions')
        .select('hashed_ip')
        .eq('hashed_ip', hashedIP)
        .limit(1);

      const isNewVisitor = !previousVisits || previousVisits.length === 0;

      // Create new session
      await supabase
        .from('visitor_sessions')
        .insert({
          session_id: body.session_id,
          hashed_ip: hashedIP,
          country: country,
          device_type: device_type,
          is_new_visitor: isNewVisitor
        });
    }

    // Update bounce status for single-page sessions
    // This will be done in a separate query after we know the page count
    if (!body.is_update) {
      // New page view - check if session has only one page
      const { data: sessionData } = await supabase
        .from('visitor_sessions')
        .select('page_count')
        .eq('session_id', body.session_id)
        .single();

      if (sessionData && sessionData.page_count === 1) {
        // Mark all page views in this session as bounces (for now)
        // We'll update this when the session ends or has more pages
        await supabase
          .from('page_views')
          .update({ is_bounce: true })
          .eq('session_id', body.session_id);
      } else if (sessionData && sessionData.page_count > 1) {
        // Not a bounce - update previous page views
        await supabase
          .from('page_views')
          .update({ is_bounce: false })
          .eq('session_id', body.session_id);
      }
    }

    // Return 204 No Content (no data leakage)
    return res.status(204).end();

  } catch (error) {
    console.error('Tracking error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
