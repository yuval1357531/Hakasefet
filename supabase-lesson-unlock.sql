-- שיעורים קפואים בקרח: נפתחים ברצף של N ימים ואז התלמיד ממיס אותם בעצמו.
-- (הכספת + מהישרדות לחופש, לכל שיעור בנפרד. ליווי אישי לא נכלל.)
-- להדביק פעם אחת ב-Supabase: Dashboard > SQL Editor > New query > Run.
-- בטוח להרצה חוזרת, גם אם כבר הרצת את הגרסה הקודמת של הקובץ הזה.
-- לא משנה ולא מוחק שום נתון או כלל קיים של שאר המערכת.
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

-- 3) מי המיס איזה שיעור. נכתב רק דרך הפונקציה hk_melt_lesson (שבודקת שבאמת הגיע ליעד).
create table if not exists public.lesson_melts (
  user_id uuid not null references auth.users(id) on delete cascade,
  section text not null,
  lesson_id text not null,
  melted_at timestamptz not null default now(),
  primary key (user_id, section, lesson_id)
);
alter table public.lesson_melts enable row level security;
drop policy if exists "melts read own or admin" on public.lesson_melts;
create policy "melts read own or admin" on public.lesson_melts
  for select using (user_id = auth.uid() or public.hk_is_admin());

create or replace function public.hk_is_melted(p_section text, p_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.lesson_melts
     where user_id = auth.uid() and section = p_section and lesson_id = p_id
  );
$$;
grant execute on function public.hk_is_melted(text, text) to authenticated;

-- 4) נעילה אמיתית בשרת: שיעור קפוא שעוד לא הומס לא נמסר בכלל (גם לא הקישור לסרטון).
--    "restrictive" = נוסף על הכללים הקיימים, לא במקומם. מאסטר רואה הכל.
--    אחרי שהומס, השיעור פתוח לתמיד (גם אם תשנה אחר כך את המספר).
drop policy if exists "hk lesson unlock gate" on public.vault_lessons;
create policy "hk lesson unlock gate" on public.vault_lessons
  as restrictive for select
  using (unlock_streak is null or (select public.hk_is_admin()) or public.hk_is_melted('vault', id::text));

drop policy if exists "hk lesson unlock gate" on public.freedom_lessons;
create policy "hk lesson unlock gate" on public.freedom_lessons
  as restrictive for select
  using (unlock_streak is null or (select public.hk_is_admin()) or public.hk_is_melted('survivalToFreedom', id::text));

-- 5) המסה: מותר רק אם הרצף הטוב ביותר הגיע ליעד של השיעור.
create or replace function public.hk_melt_lesson(p_section text, p_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  need integer;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if p_section = 'vault' then
    select unlock_streak into need from public.vault_lessons where id::text = p_id and is_active;
  elsif p_section = 'survivalToFreedom' then
    select unlock_streak into need from public.freedom_lessons where id::text = p_id and is_active;
  else
    return false;
  end if;
  if need is null then
    return true; -- השיעור לא קפוא, אין מה להמיס
  end if;
  if public.hk_best_streak() < need then
    return false;
  end if;
  insert into public.lesson_melts (user_id, section, lesson_id) values (uid, p_section, p_id)
    on conflict do nothing;
  return true;
end;
$$;
grant execute on function public.hk_melt_lesson(text, text) to authenticated;

-- 6) רשימת השיעורים הקפואים של המשתמש (כותרת + יעד + כמה ימים נשארו + האם מוכן להמסה),
--    בלי הסרטון. מאסטר מקבל רשימה ריקה (הוא רואה הכל).
drop function if exists public.hk_locked_lessons();
create or replace function public.hk_locked_lessons()
returns table(section text, id text, title text, ord integer, unlock_streak integer, days_left integer, ready boolean)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select public.hk_best_streak() as best, public.hk_is_admin() as adm)
  select 'vault'::text, l.id::text, l.title::text, l."order"::integer, l.unlock_streak,
         greatest(0, l.unlock_streak - me.best), me.best >= l.unlock_streak
    from public.vault_lessons l, me
   where l.is_active and l.unlock_streak is not null and not me.adm
     and not public.hk_is_melted('vault', l.id::text)
  union all
  select 'survivalToFreedom'::text, l.id::text, l.title::text, l."order"::integer, l.unlock_streak,
         greatest(0, l.unlock_streak - me.best), me.best >= l.unlock_streak
    from public.freedom_lessons l, me
   where l.is_active and l.unlock_streak is not null and not me.adm
     and not public.hk_is_melted('survivalToFreedom', l.id::text);
$$;
grant execute on function public.hk_locked_lessons() to authenticated;
