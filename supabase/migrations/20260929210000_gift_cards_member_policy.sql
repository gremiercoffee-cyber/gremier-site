-- "Members read own gift cards" looked up the caller's email in auth.users, which the
-- authenticated role can't read — so it errored instead of filtering. (The old
-- USING(true) policy masked this.) Use the verified email from the JWT instead.
drop policy if exists "Members read own gift cards" on public.gift_cards;
create policy "Members read own gift cards" on public.gift_cards
  for select to authenticated
  using (
    purchased_by_user = auth.uid()
    or lower(coalesce(recipient_email, '')) = lower(coalesce(auth.jwt() ->> 'email', '-'))
  );
