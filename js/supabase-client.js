// js/supabase-client.js
// ======================
// Initialize Supabase client with anon key (safe for client-side)
// DO NOT commit service_role key here!

const SUPABASE_URL = "https://ikksmrbqrirvenqlylxo.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlra3NtcmJxcmlydmVucWx5bHhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODI5ODgsImV4cCI6MjA4Mzc1ODk4OH0.1pKE6_LFTii8R-xY8WvWlXR23mXW3sUpPpKniL9fFvc";

const { createClient } = supabase; // assumes you load supabase-js via CDN below

const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Simple honeypot field name - bots usually fill hidden fields
const HONEYPOT_FIELD = "website_url";
