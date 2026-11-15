-- נעילת שיעורים לפי רצף (הכספת + מהישרדות לחופש), לכל שיעור בנפרד.
-- להדביק פעם אחת ב-Supabase: Dashboard > SQL Editor > New query > Run.
-- בטוח להרצה חוזרת. מוסיף רק עמודה אחת לכל טבלת שיעורים + כלל גישה נוסף,
-- ולא משנה ולא מוחק שום כלל או נתון קיים.
-- דורש שקובץ supabase-streak.sql כבר הורץ (טבלת login_streaks והפונקציה hk_is_admin).

-- 1) העמודה: "נפתח ברצף של N ימים". ריק (null) = פתוח לכולם.
alter table public.vault_lessons
  add column if not exists unlock_streak integer check (unlock_streak is null or unlock_streak > 0);
alter table public.freedom_lessons
  add column if not exists unlock_streak integer check (unlock_streak is null or unlock_streak > 0);

-- 2) הרצף הטוב ביותר של המשתמש המחובר (0 אם אין).
create or replace function public.hk_best_streak()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select best_streak from public.login_streaks where user_id = auth.uid()), 0);
$$;
grant execute on function public.hk_best_streak() to authenticated;

-- 3) נעילה אמיתית בשרת: שיעור שעוד לא הגעת אליו פשוט לא נמסר (לא הקישור לסרטון ולא כלום).
--    "restrictive" = נוסף על הכללים הקיימים, לא במקומם. מאסטר רואה הכל.
drop policy if exists "hk lesson unlock gate" on public.vault_lessons;
create policy "hk lesson unlock gate" on public.vault_lessons
  as restrictive for select
  using (unlock_streak is null or (select public.hk_is_admin()) or (select public.hk_best_streak()) >= unlock_streak);

drop policy if exists "hk lesson unlock gate" on public.freedom_lessons;
create policy "hk lesson unlock gate" on public.freedom_lessons
  as restrictive for select
  using (unlock_streak is null or (select public.hk_is_admin()) or (select public.hk_best_streak()) >= unlock_streak);

-- 4) רשימת השיעורים הנעולים של המשתמש (כותרת + כמה ימים נשארו בלבד, בלי הסרטון),
--    כדי שהתלמיד יראה אותם מעומעמים עם מנעול. מאסטר מקבל רשימה ריקה (הוא רואה הכל).
create or replace function public.hk_locked_lessons()
returns table(section text, id text, title text, ord integer, unlock_streak integer, days_left integer)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select public.hk_best_streak() as best, public.hk_is_admin() as adm)
  select 'vault'::text, l.id::text, l.title::text, l."order"::integer, l.unlock_streak, l.unlock_streak - me.best
    from public.vault_lessons l, me
   where l.is_active and l.unlock_streak is not null and not me.adm and l.unlock_streak > me.best
  union all
  select 'survivalToFreedom'::text, l.id::text, l.title::text, l."order"::integer, l.unlock_streak, l.unlock_streak - me.best
    from public.freedom_lessons l, me
   where l.is_active and l.unlock_streak is not null and not me.adm and l.unlock_streak > me.best;
$$;
grant execute on function public.hk_locked_lessons() to authenticated;
