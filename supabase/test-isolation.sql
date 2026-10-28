-- Transactional verification: fixture accounts and journals are rolled back.
begin;
select set_config('nourish.test_a',gen_random_uuid()::text,true);
select set_config('nourish.test_b',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('nourish.test_a')::uuid),(current_setting('nourish.test_b')::uuid);
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('nourish.test_a'),true);
do $$
declare result jsonb; conflict_seen boolean := false; forbidden_seen boolean := false;
begin
  result := public.save_nourish_journal('{"version":1,"foods":[],"favourites":[],"weights":[]}',0);
  if (result->>'revision')::int <> 1 then raise exception 'First save revision failed'; end if;
  begin
    perform public.save_nourish_journal('{"version":1,"foods":[],"favourites":[],"weights":[]}',0);
  exception when raise_exception then
    if sqlerrm = 'journal_conflict' then conflict_seen := true; else raise; end if;
  end;
  if not conflict_seen then raise exception 'Stale save unexpectedly succeeded'; end if;
  result := public.save_nourish_journal('{"version":1,"foods":[],"favourites":[],"weights":[]}',1);
  if (result->>'revision')::int <> 2 then raise exception 'Update revision failed'; end if;
  begin
    update public.nourish_journals set user_id=current_setting('nourish.test_b')::uuid;
  exception when insufficient_privilege then forbidden_seen := true;
  end;
  if not forbidden_seen then raise exception 'Owner reassignment was permitted'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('nourish.test_b'),true);
do $$
declare touched integer; forbidden_seen boolean := false;
begin
  if (select count(*) from public.nourish_journals) <> 0 then raise exception 'Cross-account read leaked'; end if;
  update public.nourish_journals set revision=999 where user_id=current_setting('nourish.test_a')::uuid;
  get diagnostics touched = row_count;
  if touched <> 0 then raise exception 'Cross-account update succeeded'; end if;
  begin
    insert into public.nourish_journals(user_id,document)
      values(current_setting('nourish.test_a')::uuid,'{"version":1,"foods":[],"favourites":[],"weights":[]}');
  exception when insufficient_privilege then forbidden_seen := true;
  end;
  if not forbidden_seen then raise exception 'Cross-account insert succeeded'; end if;
  perform public.save_nourish_journal('{"version":1,"foods":[],"favourites":[],"weights":[]}',0);
  if (select count(*) from public.nourish_journals) <> 1 then raise exception 'Account isolation count failed'; end if;
end $$;
reset role;
rollback;
