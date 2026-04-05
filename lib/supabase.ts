/**
 * Supabase client for the Kira assistant project.
 * Used for Realtime subscriptions on kira_messages table.
 */

import { createClient } from "@supabase/supabase-js";

// Kira-assistant Supabase project
const SUPABASE_URL = "https://odxjaqwlzjxowfnajygb.supabase.co";
// Anon key — safe for public repos. RLS policies control access.
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9keGphcXdsemp4b3dmbmFqeWdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTEyMjQsImV4cCI6MjA4OTY2NzIyNH0.BIcTIZ0800C6p_xCUgkw9pgSq553_nx4h08Eai7NoSM";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});
