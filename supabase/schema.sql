-- Nourish cloud journal. Apply once to a new Supabase project.
create table public.nourish_journals (
  user_id uuid primary key references auth.users(id) on delete cascade,
  document jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  constraint journal_shape check (
    jsonb_typeof(document) = 'object'
    and document @> '{"version":1}'::jsonb
    and jsonb_typeof(document->'foods') = 'array'
    and jsonb_typeof(document->'favourites') = 'array'
    and jsonb_typeof(document->'weights') = 'array'
    and document ?& array['version','foods','favourites','weights']
    and octet_length(document::text) <= 10000000
  )
);
alter table public.nourish_journals enable row level security;
create policy "Read own journal" on public.nourish_journals
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Insert own journal" on public.nourish_journals
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own journal" on public.nourish_journals
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
revoke all on public.nourish_journals from anon, authenticated;
grant select, insert, update on public.nourish_journals to authenticated;

-- Compare-and-swap: a stale device must reload before writing again.
-- Invoker privileges preserve the table's ownership policies.
create function public.save_nourish_journal(next_document jsonb, expected_revision bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare saved public.nourish_journals;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if expected_revision is null or expected_revision < 0 then
    raise exception 'invalid_revision' using errcode = '22023';
  end if;
  if expected_revision = 0 then
    insert into public.nourish_journals(user_id, document)
      values(auth.uid(), next_document)
      on conflict(user_id) do nothing returning * into saved;
  else
    update public.nourish_journals
      set document = next_document, revision = revision + 1, updated_at = now()
      where user_id = auth.uid() and revision = expected_revision
      returning * into saved;
  end if;
  if saved.user_id is null then raise exception 'journal_conflict' using errcode = 'P0001'; end if;
  return jsonb_build_object('document', saved.document, 'revision', saved.revision);
end;
$$;
revoke all on function public.save_nourish_journal(jsonb,bigint) from public, anon;
grant execute on function public.save_nourish_journal(jsonb,bigint) to authenticated;
