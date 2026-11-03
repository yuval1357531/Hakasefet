-- הרצף (login streak) + שיפורי המשפט היומי.
-- להדביק פעם אחת ב-Supabase: Dashboard > SQL Editor > New query > Run.
-- בטוח להרצה חוזרת (if not exists / on conflict do nothing), ולא נוגע בשום טבלה קיימת
-- מלבד הוספת שתי עמודות אופציונליות ל-daily_wheel_*.

-- ---------------------------------------------------------------
-- עזר: האם המשתמש המחובר הוא מאסטר
-- ---------------------------------------------------------------
create or replace function public.hk_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;
grant execute on function public.hk_is_admin() to authenticated;

-- ---------------------------------------------------------------
-- הרצף: מצב לכל משתמש
-- ---------------------------------------------------------------
create table if not exists public.login_streaks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  current_streak integer not null default 0,
  best_streak integer not null default 0,
  last_day date,
  updated_at timestamptz not null default now()
);
alter table public.login_streaks enable row level security;

drop policy if exists "streak read own or admin" on public.login_streaks;
create policy "streak read own or admin" on public.login_streaks
  for select using (user_id = auth.uid() or public.hk_is_admin());
-- אין insert/update ישיר מהדפדפן -- רק דרך הפונקציה למטה (שעון שרת, אי אפשר לרמות).

-- ---------------------------------------------------------------
-- ספירת כניסה: פעם אחת ליום (שעון ישראל). יום רצוף = +1, דילוג על יום שלם = חזרה ל-1.
-- ---------------------------------------------------------------
create or replace function public.touch_login_streak()
returns table(out_current integer, out_best integer, out_last_day date)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'Asia/Jerusalem')::date;
  r public.login_streaks%rowtype;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  -- שורה ריקה אם אין עדיין, ואז נעילה: שתי קריאות במקביל (דשבורד + אזור אישי) לא מתנגשות.
  insert into public.login_streaks (user_id) values (uid) on conflict (user_id) do nothing;
  select * into r from public.login_streaks where user_id = uid for update;

  if r.last_day is not null and r.last_day >= today then
    null; -- כבר נספר היום
  elsif r.last_day = today - 1 then
    update public.login_streaks
       set current_streak = r.current_streak + 1,
           best_streak = greatest(r.best_streak, r.current_streak + 1),
           last_day = today,
           updated_at = now()
     where user_id = uid
    returning * into r;
  else
    -- כניסה ראשונה אי פעם, או דילוג על יום שלם: מתחילים מחדש מ-1
    update public.login_streaks
       set current_streak = 1,
           best_streak = greatest(r.best_streak, 1),
           last_day = today,
           updated_at = now()
     where user_id = uid
    returning * into r;
  end if;

  return query select r.current_streak, r.best_streak, r.last_day;
end;
$$;
grant execute on function public.touch_login_streak() to authenticated;

-- ---------------------------------------------------------------
-- מתנות הרצף (המאסטר מגדיר) + מי אסף מה
-- ---------------------------------------------------------------
create table if not exists public.streak_rewards (
  id text primary key,
  days integer not null check (days > 0),
  title text not null,
  description text,
  icon text,
  created_at timestamptz not null default now()
);
alter table public.streak_rewards enable row level security;

drop policy if exists "rewards read all" on public.streak_rewards;
create policy "rewards read all" on public.streak_rewards
  for select using (auth.role() = 'authenticated');
drop policy if exists "rewards admin write" on public.streak_rewards;
create policy "rewards admin write" on public.streak_rewards
  for all using (public.hk_is_admin()) with check (public.hk_is_admin());

create table if not exists public.streak_claims (
  user_id uuid not null references auth.users(id) on delete cascade,
  reward_id text not null references public.streak_rewards(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  primary key (user_id, reward_id)
);
alter table public.streak_claims enable row level security;

drop policy if exists "claims read own or admin" on public.streak_claims;
create policy "claims read own or admin" on public.streak_claims
  for select using (user_id = auth.uid() or public.hk_is_admin());
-- אפשר לאסוף רק מתנה שהרצף הטוב ביותר שלך הגיע אליה.
drop policy if exists "claims insert own if earned" on public.streak_claims;
create policy "claims insert own if earned" on public.streak_claims
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1
        from public.login_streaks s
        join public.streak_rewards r on r.id = reward_id
       where s.user_id = auth.uid() and s.best_streak >= r.days
    )
  );
drop policy if exists "claims admin delete" on public.streak_claims;
create policy "claims admin delete" on public.streak_claims
  for delete using (public.hk_is_admin());

-- המתנות הראשונות (אפשר לשנות/להוסיף מתוך האתר, באזור האישי של המאסטר)
insert into public.streak_rewards (id, days, title, description, icon) values
  ('sr-30', 30, 'פגישת ערך אישית עם ג''אוריוס', '20 דקות, אחד על אחד', 'meeting'),
  ('sr-60', 60, 'קורס ביטחון אקסקלוסיבי', 'קורס ביטחון מיוחד, רק למי שהגיע עד כאן', 'course')
on conflict (id) do nothing;

-- ---------------------------------------------------------------
-- משפט יומי: תג נושא למשפט + רשימת "משפטים שכבר ראית" לכל משתמש
-- ---------------------------------------------------------------
alter table public.daily_wheel_sentences add column if not exists topic text;
alter table public.daily_wheel_spins add column if not exists seen_ids text[] not null default '{}';

-- 41 משפטים שנבחרו. topic = נושא להתאמה אישית לפי מה שהמשתמש צופה בו.
insert into public.daily_wheel_sentences (id, text, topic) values
  ('dws-s02', 'כשאתה שקט מבפנים, אין מה להוכיח בחוץ.', 'presence'),
  ('dws-s03', 'גבר אמיתי לא ממהר, הוא פשוט נמצא.', 'masculinity'),
  ('dws-s05', 'אל תסביר את עצמך. תהיה.', 'presence'),
  ('dws-s06', 'ביטחון נבנה מהבטחות קטנות שאתה מקיים לעצמך.', 'confidence'),
  ('dws-s07', 'מי שלא זז כשלוחצים עליו, מוביל.', 'masculinity'),
  ('dws-s08', 'תפסיק לחפש אישור, תתחיל לתת כיוון.', 'confidence'),
  ('dws-s09', 'השקט שלך חזק יותר מכל משפט חכם.', 'presence'),
  ('dws-s10', 'לא כל שיחה צריכה מנצח.', 'presence'),
  ('dws-s12', 'תקשורת טובה מתחילה בלהרגיש, לא בלדבר.', 'presence'),
  ('dws-s13', 'מילה אחת בביטחון שווה פסקה בהתנצלות.', 'presence'),
  ('dws-s16', 'אל תמלא כל שקט. שקט הוא מרחב.', 'presence'),
  ('dws-s18', 'עיניים רגועות אומרות יותר ממאה מילים.', 'presence'),
  ('dws-s19', 'לא משנה מה אומרים, משנה מאיפה.', 'presence'),
  ('dws-s21', 'משיכה היא לא טכניקה, היא תדר.', 'women'),
  ('dws-s22', 'אישה מרגישה את מי שנמצא איתה, לא את מה שהוא אומר.', 'women'),
  ('dws-s23', 'תהיה גבר שנעים להיות לידו, לא גבר שצריך לרצות.', 'women'),
  ('dws-s24', 'סקרנות מושכת יותר מהצגה.', 'women'),
  ('dws-s25', 'אל תרדוף, תוביל.', 'women'),
  ('dws-s28', 'כבוד עצמי הוא הדבר הכי מושך שיש.', 'women'),
  ('dws-s31', 'שליטה ביצרים היא לא דיכוי, היא הכוונה.', 'sexuality'),
  ('dws-s33', 'תשוקה בלי שליטה שורפת, עם שליטה מאירה.', 'sexuality'),
  ('dws-s34', 'לא כל דחף צריך מענה, חלקם צריכים נשימה.', 'sexuality'),
  ('dws-s36', 'בין הדחף למעשה יש רגע, ושם נמצאת החירות שלך.', 'sexuality'),
  ('dws-s37', 'אנרגיה מינית מנוהלת הופכת לכוח יצירה.', 'sexuality'),
  ('dws-s38', 'מי ששולט ביצר שלו, לא נשלט על ידי אף אחד.', 'sexuality'),
  ('dws-s40', 'ביטחון הוא לא להיות בטוח בהצלחה, אלא להיות בטוח בעצמך גם בכישלון.', 'confidence'),
  ('dws-s41', 'אתה לא צריך להיות מושלם כדי להיות ראוי.', 'confidence'),
  ('dws-s43', 'כל פעם שאתה פועל למרות הפחד, אתה בונה אמון בעצמך.', 'confidence'),
  ('dws-s44', 'הקול הפנימי שלך הוא שיחה, ואתה יכול לבחור את הטון.', 'confidence'),
  ('dws-s45', 'אל תחכה להרגיש מוכן. תפעל, והתחושה תבוא.', 'confidence'),
  ('dws-s47', 'מי שיודע מה הוא שווה, לא מתמקח על זה.', 'confidence'),
  ('dws-s48', 'צעד קטן היום עדיף על קפיצה מחר.', 'confidence'),
  ('dws-s50', 'נשימה ארוכה אחת משנה את כל המערכת.', 'anxiety'),
  ('dws-s51', 'אתה לא המחשבות שלך, אתה זה שמסתכל עליהן.', 'anxiety'),
  ('dws-s52', 'מה שאתה מתנגד לו מתעצם, מה שאתה מקבל נרגע.', 'anxiety'),
  ('dws-s71', 'שמחה היא לא יעד, היא נקודת פתיחה.', 'wealth'),
  ('dws-s72', 'תודה היא המפתח הראשון של השפע.', 'wealth'),
  ('dws-s73', 'תעשה יותר ממה שאתה אוהב, והכסף ילמד לבוא.', 'wealth'),
  ('dws-s74', 'מי שנהנה מהדרך לא מחכה לשמחה בסופה.', 'wealth'),
  ('dws-s75', 'אל תחסוך בחיים כדי לחסוך בכסף.', 'wealth'),
  ('dws-s76', 'שפע הוא החלטה יומית, לא מזל.', 'wealth')
on conflict (id) do nothing;
