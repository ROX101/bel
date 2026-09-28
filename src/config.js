/* ============================================================
   Supabase configuration — ported verbatim from the original bel-portal/config.js.
   Same url / anonKey / storageBucket values, so the React app talks to the
   exact same real Supabase project. See SUPABASE_SETUP.md in the original
   project for the full setup steps.
   ============================================================ */
export const SUPABASE_CONFIG = {
  url: 'https://vnesueixbttnmyqaggbb.supabase.co', // Project Settings → API → Project URL
  anonKey: 'sb_publishable_XPwYvZEJ6GG7_MFhBqP8Og_PNFh5RtR', // Project Settings → API → Publishable key — safe to expose client-side; access is governed by RLS
  storageBucket: 'bel-assets', // Storage bucket name for uploaded asset files (created by supabase/schema.sql)
};

// Kept on window too: the ported legacy UI layer (src/legacy/app-legacy.js) does not read
// this directly, but src/engine/supabase-sync.js's window.SupabaseSync bridge follows the
// same "still visible as a global" pattern as the original app for anything that expects it.
if (typeof window !== 'undefined') window.SUPABASE_CONFIG = SUPABASE_CONFIG;

export default SUPABASE_CONFIG;
