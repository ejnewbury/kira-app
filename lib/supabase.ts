/**
 * Supabase client for the Kira assistant project.
 * Used for Realtime subscriptions on kira_messages table.
 */

import { createClient } from "@supabase/supabase-js";

// Kira-assistant Supabase project
const SUPABASE_URL = "https://odxjaqwlzjxowfnajygb.supabase.co";
// Using service role key since this is a personal app with permissive RLS.
// TODO: swap to anon key from Supabase dashboard (Settings > API) for production.
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9keGphcXdsemp4b3dmbmFqeWdiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDA5MTIyNCwiZXhwIjoyMDg5NjY3MjI0fQ.k9RwizmbH5ac-ASMkRkIw_oaSDA8MeWjsr4nGOyYkfQ";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});
