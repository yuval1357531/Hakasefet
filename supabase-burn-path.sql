-- מסלול בערה: 7 צעדים (מבוא, שיעור 1, תרגול שחרור, שיעור 2, תרגול נשימות,
-- שיעור 3, תרגול יציבות). צעד נחשב כשהשיעור מסומן "צפיתי" ונכנסו אליו אחרי
-- שהמסלול התחיל. לכל היותר צעד אחד ביום (שעון ישראל); צעד שלא נעשה פשוט מחכה.
-- כשנפתח יום 7, תרגול היציבות נפתח לו גם אם הוא קפוא ברצף.
-- רשימת הצעדים זהה לזו שב-js/chargeDays.js.

create table public.burn_paths (
  user_id uuid primary key references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  log jsonb not null default '{}'::jsonb,   -- lesson id -> Israel date it was counted
  completed_at timestamptz
);
alter table public.burn_paths enable row level security;
create policy "burn read own or admin" on public.burn_paths
  for select using (user_id = auth.uid() or hk_is_admin());
revoke insert, update, delete on public.burn_paths from anon, authenticated;

create or replace function public.hk_burn_steps()
returns text[] language sql immutable as $$
  select array['vlesson-1', 'vlesson-2', 'flesson-mu5030plj1cou', 'vlesson-mv0rn5xz9cmrr',
               'flesson-mv0runti37o6a', 'vlesson-3', 'flesson-muny6f0zh91at'];
$$;

-- Counts what can be counted now, and returns the path as it stands.
create or replace function public.burn_sync(p_start boolean default false)
returns table(out_started timestamptz, out_log jsonb, out_completed timestamptz, out_today date)
language plpgsql security definer set search_path to 'public' as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'Asia/Jerusalem')::date;
  steps text[] := hk_burn_steps();
  r public.burn_paths%rowtype;
  i int;
  prev date;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_start then
    insert into public.burn_paths (user_id) values (uid) on conflict (user_id) do nothing;
  end if;
  select * into r from public.burn_paths where user_id = uid for update;
  if not found then
    return query select null::timestamptz, '{}'::jsonb, null::timestamptz, today;
    return;
  end if;

  if r.completed_at is null then
    for i in 1..7 loop
      continue when r.log ? steps[i];
      if i > 1 then
        prev := (r.log ->> steps[i - 1])::date;
        exit when prev is null or prev >= today;  -- one step a day
      end if;
      exit when not exists (
        select 1 from public.progress p
         where p.user_id = uid and p.lesson_id = steps[i]
           and p.is_completed and p.last_watched_at >= r.started_at
      );
      r.log := r.log || jsonb_build_object(steps[i], today::text);
      if i = 7 then r.completed_at := now(); end if;
      exit; -- counted today's step
    end loop;
    update public.burn_paths set log = r.log, completed_at = r.completed_at where user_id = uid;
  end if;

  -- the day-7 practice opens with day 7, whatever its own streak gate says
  if r.log ? steps[6] then
    insert into public.lesson_melts (user_id, section, lesson_id)
    values (uid, 'survivalToFreedom', steps[7]) on conflict do nothing;
  end if;

  return query select r.started_at, r.log, r.completed_at, today;
end;
$$;
revoke all on function public.burn_sync(boolean) from public, anon;
grant execute on function public.burn_sync(boolean) to authenticated;
