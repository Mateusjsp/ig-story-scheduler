-- Reivindica atomicamente até `lim` posts vencidos, marcando-os 'publishing'.
-- FOR UPDATE SKIP LOCKED garante que instâncias concorrentes nunca pegam o mesmo post.
create or replace function claim_due_posts(lim int default 20)
returns setof posts
language sql
as $$
  update posts p
  set status = 'publishing', attempts = p.attempts + 1, updated_at = now()
  where p.id in (
    select id from posts
    where status = 'queued' and scheduled_at <= now()
    order by scheduled_at
    for update skip locked
    limit lim
  )
  returning p.*;
$$;
