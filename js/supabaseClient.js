// Shared Supabase client, loaded via ESM CDN import so the rest of the
// site keeps its zero-build-step property (no bundler anywhere except the
// isolated /api serverless functions, which Vercel builds independently).
//
// The anon key is safe to ship here -- it's meant to be public. Row Level
// Security on every table is the real security boundary, not key secrecy.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = 'https://zlxuyvvriwwvvlkbrzgb.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpseHV5dnZyaXd3dnZsa2JyemdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NzA1NTIsImV4cCI6MjA5ODE0NjU1Mn0.zZ0TEcwNgm2VMyPd-HEw3iT1csrQMTrBS6KUXDoKjt8';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Exposed only for the one call site that needs to bypass the supabase-js
// client entirely: large trail-media video uploads via the TUS/resumable
// protocol (see vaultStore.js/freedomStore.js/personalGuidanceStore.js's
// uploadTrailMedia) -- tus-js-client talks directly to Supabase's dedicated
// resumable-upload host, not through the regular REST client, so it needs
// its own copy of the anon key (for the `apikey` header) and a derived
// endpoint URL. Not a new secret -- SUPABASE_ANON_KEY was already public in
// this same file.
export { SUPABASE_ANON_KEY };
export const SUPABASE_STORAGE_TUS_ENDPOINT = SUPABASE_URL.replace('.supabase.co', '.storage.supabase.co') + '/storage/v1/upload/resumable';
