// Public, unauthenticated read for the "/free/<slug>" tutorial page.
// This is the ONLY way a public visitor's browser ever sees data derived
// from vault_lessons -- RLS on both free_tutorials and vault_lessons
// requires a signed-in session, so an anonymous client-side read is
// impossible by design. This endpoint uses the service-role key (like
// create-user.js) to look the record up server-side, but unlike every
// other api/*.js file it takes NO Authorization header, because its
// entire purpose is to serve an unauthenticated visitor.
//
// Contract:
//   GET /api/free-tutorial?slug=<slug>
//   -> 200 { ok: true, title, embedUrl }
//   -> 200 { ok: false }   (slug missing/unknown/inactive/expired/broken
//                           lesson link -- deliberately generic, never
//                           reveals which condition failed)
//
// lessonId is NEVER accepted as input here -- only slug. The only path
// from a request to a lesson row is: slug -> free_tutorials row (which
// must already be active/unexpired) -> its own stored lesson_id. There
// is no way to reach an unpublished lesson by guessing/editing an id.

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false });
    return;
  }

  const slug = String(req.query?.slug || '').trim();
  if (!slug) {
    res.status(200).json({ ok: false });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ ok: false });
    return;
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: tutorial, error: tutorialError } = await admin
    .from('free_tutorials')
    .select('lesson_id, public_title, active, expires_at')
    .eq('slug', slug)
    .maybeSingle();

  if (tutorialError || !tutorial || !tutorial.active) {
    res.status(200).json({ ok: false });
    return;
  }

  // Plain 'YYYY-MM-DD' string comparison against today's date, same
  // convention as access_expiry_date in js/auth.js's isAccessExpired --
  // expires at the START of that day everywhere, no time-of-day/timezone
  // ambiguity.
  if (tutorial.expires_at) {
    const today = new Date().toISOString().slice(0, 10);
    if (tutorial.expires_at < today) {
      res.status(200).json({ ok: false });
      return;
    }
  }

  const { data: lesson, error: lessonError } = await admin
    .from('vault_lessons')
    .select('title, embed_url, is_active')
    .eq('id', tutorial.lesson_id)
    .maybeSingle();

  if (lessonError || !lesson || !lesson.is_active) {
    res.status(200).json({ ok: false });
    return;
  }

  res.status(200).json({
    ok: true,
    title: tutorial.public_title || lesson.title,
    embedUrl: lesson.embed_url || '',
  });
}
