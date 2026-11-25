-- הרצף לפי הידית (מחליף את הספירה לפי כניסה ליום בלוח השנה)
-- ---------------------------------------------------------------
-- * רק משיכת הידית (שמירת המשפט היומי) מעלה את הרצף.
-- * אחרי משיכה הידית נעולה 20 שעות, ולכל היותר משיכה אחת ביום (שעון ישראל).
-- * הרצף מחזיק 48 שעות מהמשיכה (20 נעולה + 28 לשימוש). אחר כך הוא מתאפס;
--   השיא (best_streak) לא יורד לעולם, ולכן היעדים והמתנות נשמרים.
-- * הכל לפי שעון השרת.

-- גיבוי מלא של המצב לפני המעבר (לא נגיש מהאתר)
create table public.login_streaks_backup_20261125 as select * from public.login_streaks;
alter table public.login_streaks_backup_20261125 enable row level security;
revoke all on public.login_streaks_backup_20261125 from anon, authenticated;

alter table public.login_streaks
  add column last_pull_at timestamptz,
  add column deadline_at timestamptz;

-- מעבר: המספרים לא משתנים. רצף חי (נכנס היום או אתמול) מקבל 48 שעות מלאות.
update public.login_streaks l
   set last_pull_at = (select least(s.spun_at, now()) from public.daily_wheel_spins s where s.user_id = l.user_id),
       deadline_at = case when l.last_day >= (now() at time zone 'Asia/Jerusalem')::date - 1
                          then now() + interval '48 hours' end;

-- מתי הידית נפתחת אחרי משיכה: 20 שעות, ולא לפני חצות (ישראל)
create or replace function public.hk_lever_unlock_at(p timestamptz)
returns timestamptz language sql stable set search_path to 'public' as $$
  select greatest(p + interval '20 hours',
                  (((p at time zone 'Asia/Jerusalem')::date + 1)::timestamp at time zone 'Asia/Jerusalem'));
$$;

-- הספירה עצמה: רצה עם שמירת המשפט היומי, גם מגרסה ישנה שעוד פתוחה אצל תלמיד.
create or replace function public.hk_count_lever_pull()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  today date := (now() at time zone 'Asia/Jerusalem')::date;
  r public.login_streaks%rowtype;
  n integer;
begin
  if auth.uid() is null or auth.uid() <> new.user_id or hk_is_admin() then
    return new;
  end if;

  insert into public.login_streaks (user_id) values (new.user_id) on conflict (user_id) do nothing;
  select * into r from public.login_streaks where user_id = new.user_id for update;

  if r.last_pull_at is null or now() >= hk_lever_unlock_at(r.last_pull_at) then
    if r.deadline_at is not null and now() <= r.deadline_at then
      -- last_day = today: כבר נספר היום לפי הכלל הישן (יום המעבר בלבד)
      n := case when r.last_day = today then r.current_streak else r.current_streak + 1 end;
    else
      n := 1;
    end if;
    update public.login_streaks
       set current_streak = n,
           best_streak = greatest(r.best_streak, n),
           last_day = today,
           last_pull_at = now(),
           deadline_at = now() + interval '48 hours',
           updated_at = now()
     where user_id = new.user_id
    returning * into r;
  end if;

  new.spun_at := r.last_pull_at; -- שעון השרת, לא שעון המכשיר
  return new;
end;
$$;
revoke all on function public.hk_count_lever_pull() from public, anon, authenticated;

create trigger hk_count_lever_pull
  before insert or update on public.daily_wheel_spins
  for each row execute function public.hk_count_lever_pull();

-- קריאת המצב (לא כותבת דבר)
create or replace function public.get_streak_state()
returns table(out_current integer, out_best integer, out_last_day date,
              out_deadline timestamptz, out_now timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select case when l.deadline_at is not null and now() <= l.deadline_at then l.current_streak else 0 end,
         coalesce(l.best_streak, 0), l.last_day, l.deadline_at, now()
    from (select auth.uid() as uid) me
    left join public.login_streaks l on l.user_id = me.uid
   where me.uid is not null;
$$;
revoke all on function public.get_streak_state() from public, anon;
grant execute on function public.get_streak_state() to authenticated;

-- גרסאות ישנות שעוד פתוחות קוראות לזו בכניסה: מעכשיו היא רק מחזירה את המצב.
create or replace function public.touch_login_streak()
returns table(out_current integer, out_best integer, out_last_day date)
language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  return query select s.out_current, s.out_best, s.out_last_day from public.get_streak_state() s;
end;
$$;
