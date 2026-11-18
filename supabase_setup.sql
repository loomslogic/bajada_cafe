-- =====================================================================
-- Bajada Cafe online ordering: Supabase setup
-- Paste this whole file into Supabase > SQL Editor > New query, then Run.
-- BEFORE running: replace REPLACE_WITH_STAFF_EMAIL (below) with the email
-- you will use to sign in to admin.html.
-- =====================================================================

-- 1) Staff allow-list -------------------------------------------------
create table if not exists public.staff (email text primary key);
insert into public.staff (email) values (lower('argiebendanillo987@gmail.com')) on conflict do nothing;

create or replace function public.is_staff() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.staff where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

create or replace function public.am_i_staff() returns boolean
language sql security definer stable set search_path = public as $$ select public.is_staff(); $$;
grant execute on function public.am_i_staff() to authenticated;

-- 2) Tables ------------------------------------------------------------
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  store_open boolean not null default true,
  store_message text not null default '',
  store_reopen_at timestamptz,
  dine_in_available boolean not null default true,
  dine_in_reason text not null default '',
  dine_in_reopen_at timestamptz,
  gcash_number text not null default '0900 000 0000',
  gcash_name text not null default 'Bajada Cafe'
);
insert into public.settings (id) values (1) on conflict do nothing;

create table if not exists public.menu_items (
  key text primary key,                 -- "Category|Item name"
  category text not null,
  name text not null,
  prices jsonb not null,                -- e.g. [120,140]
  labels jsonb not null default '[]',   -- e.g. ["16oz","22oz"]
  status text not null default 'on' check (status in ('on','soldout','removed')),
  updated_at timestamptz not null default now()
);

create sequence if not exists public.order_seq start 1;

create table if not exists public.orders (
  id bigint generated always as identity primary key,
  ref text unique not null,
  created_at timestamptz not null default now(),
  customer_name text not null,
  mobile text not null,
  instructions text not null default '',
  order_type text not null check (order_type in ('pickup','dine_in')),
  seats int,
  arrival text,
  items jsonb not null,
  total numeric(10,2) not null,
  status text not null default 'awaiting_payment'
    check (status in ('awaiting_payment','awaiting_verification','paid','preparing','ready','done','cancelled')),
  proof_path text
);

-- 3) Row level security -------------------------------------------------
alter table public.staff      enable row level security;   -- no policies = nobody can read it directly
alter table public.settings   enable row level security;
alter table public.menu_items enable row level security;
alter table public.orders     enable row level security;

-- Table permissions (Row Level Security below decides which rows each role may touch)
grant usage on schema public to anon, authenticated;
grant select on public.settings, public.menu_items to anon, authenticated;
grant update on public.settings to authenticated;
grant insert, update, delete on public.menu_items to authenticated;
grant select, update on public.orders to authenticated;

drop policy if exists "settings read"   on public.settings;
drop policy if exists "settings write"  on public.settings;
create policy "settings read"  on public.settings for select to anon, authenticated using (true);
create policy "settings write" on public.settings for update to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "menu read"  on public.menu_items;
drop policy if exists "menu write" on public.menu_items;
create policy "menu read"  on public.menu_items for select to anon, authenticated using (true);
create policy "menu write" on public.menu_items for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "orders staff" on public.orders;
create policy "orders staff" on public.orders for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- 4) Functions the website calls (customers never touch the tables) -------
create or replace function public.place_order(
  p_name text, p_mobile text, p_instructions text, p_type text,
  p_seats int, p_arrival text, p_items jsonb
) returns table (order_ref text, order_total numeric)
language plpgsql security definer set search_path = public as $$
declare
  s public.settings%rowtype;
  it jsonb; m public.menu_items%rowtype;
  v_total numeric := 0; v_lines jsonb := '[]'::jsonb;
  v_idx int; v_qty int; v_price numeric; v_ref text;
begin
  select * into s from public.settings where id = 1;
  if not (s.store_open or (s.store_reopen_at is not null and now() >= s.store_reopen_at)) then
    raise exception 'STORE_CLOSED';
  end if;
  if p_type not in ('pickup','dine_in') then raise exception 'BAD_TYPE'; end if;
  if p_type = 'dine_in' and not (s.dine_in_available or (s.dine_in_reopen_at is not null and now() >= s.dine_in_reopen_at)) then
    raise exception 'DINE_IN_UNAVAILABLE';
  end if;
  if length(trim(coalesce(p_name,''))) < 2 or length(p_name) > 80 then raise exception 'BAD_NAME'; end if;
  if coalesce(p_mobile,'') !~ '^09[0-9]{9}$' then raise exception 'BAD_MOBILE'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 40 then
    raise exception 'BAD_ITEMS';
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    select * into m from public.menu_items where key = it ->> 'k';
    if not found or m.status <> 'on' then raise exception 'ITEM_UNAVAILABLE'; end if;
    v_idx := coalesce((it ->> 's')::int, 0);
    v_qty := (it ->> 'q')::int;
    if v_qty is null or v_qty < 1 or v_qty > 20 then raise exception 'BAD_QTY'; end if;
    if v_idx < 0 or v_idx >= jsonb_array_length(m.prices) then raise exception 'BAD_SIZE'; end if;
    v_price := (m.prices ->> v_idx)::numeric;
    v_total := v_total + v_price * v_qty;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'name', m.name, 'size', coalesce(m.labels ->> v_idx, ''), 'qty', v_qty, 'price', v_price));
  end loop;

  v_ref := to_char(now(), 'YY') || '-' || lpad(nextval('public.order_seq')::text, 5, '0');
  insert into public.orders (ref, customer_name, mobile, instructions, order_type, seats, arrival, items, total)
  values (v_ref, trim(p_name), p_mobile, left(coalesce(p_instructions,''), 300), p_type,
          case when p_type = 'dine_in' then greatest(1, least(coalesce(p_seats,1), 50)) end,
          left(coalesce(p_arrival,''), 40), v_lines, v_total);
  return query select v_ref, v_total;
end $$;

create or replace function public.attach_proof(p_ref text, p_mobile text, p_path text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_path not like p_ref || '/%' then return false; end if;
  update public.orders set proof_path = p_path, status = 'awaiting_verification'
   where ref = p_ref and mobile = p_mobile and status in ('awaiting_payment','awaiting_verification');
  return found;
end $$;

create or replace function public.order_status(p_ref text, p_mobile text) returns text
language sql security definer stable set search_path = public as $$
  select status from public.orders where ref = p_ref and mobile = p_mobile;
$$;

revoke all on function public.place_order(text,text,text,text,int,text,jsonb) from public;
revoke all on function public.attach_proof(text,text,text) from public;
revoke all on function public.order_status(text,text) from public;
grant execute on function public.place_order(text,text,text,text,int,text,jsonb) to anon, authenticated;
grant execute on function public.attach_proof(text,text,text) to anon, authenticated;
grant execute on function public.order_status(text,text) to anon, authenticated;

-- 5) Storage for GCash screenshots (private; customers can upload only) ---
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "proofs upload" on storage.objects;
drop policy if exists "proofs staff read" on storage.objects;
create policy "proofs upload" on storage.objects for insert to anon, authenticated with check (bucket_id = 'payment-proofs');
create policy "proofs staff read" on storage.objects for select to authenticated using (bucket_id = 'payment-proofs' and public.is_staff());

-- 6) Menu (generated from menu.js). Prices here are what customers are charged.
insert into public.menu_items (key,category,name,prices,labels) values
('Iced Series|Iced Americano','Iced Series','Iced Americano','[100, 120]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Iced Series|Iced Cafe Latte','Iced Series','Iced Cafe Latte','[120, 140]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Iced Series|Iced Cappuccino','Iced Series','Iced Cappuccino','[120, 140]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Iced Series|Iced Spanish Latte','Iced Series','Iced Spanish Latte','[130, 150]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Iced Series|Iced Dirty Matcha','Iced Series','Iced Dirty Matcha','[130, 150]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Iced Series|Iced Dark Mocha','Iced Series','Iced Dark Mocha','[135, 155]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Iced Series|Iced Salted Caramel','Iced Series','Iced Salted Caramel','[135, 155]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Iced Series|Iced French Vanilla','Iced Series','Iced French Vanilla','[135, 155]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Iced Series|Iced Hazelnut','Iced Series','Iced Hazelnut','[120, 140]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Iced Series|Iced Caramel Macchiato','Iced Series','Iced Caramel Macchiato','[145, 165]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Iced Series|Iced Biscoff','Iced Series','Iced Biscoff','[120, 140]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Iced Series|Ceremonial Matcha','Iced Series','Ceremonial Matcha','[240, 270]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Iced Series|Choco Cloud','Iced Series','Choco Cloud','[130, 150]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Iced Series|Sea Salt Matcha','Iced Series','Sea Salt Matcha','[130, 150]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Iced Series|Smore Latte','Iced Series','Smore Latte','[159, 179]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Iced Series|Strawberry Cream Matcha','Iced Series','Strawberry Cream Matcha','[135, 155]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Hot Series|Hot Americano','Hot Series','Hot Americano','[100]'::jsonb,'[]'::jsonb),
('Hot Series|Hot Cafe Latte','Hot Series','Hot Cafe Latte','[120]'::jsonb,'[]'::jsonb),
('Hot Series|Hot Cappuccino','Hot Series','Hot Cappuccino','[120]'::jsonb,'[]'::jsonb),
('Hot Series|Hot Ceremonial Matcha','Hot Series','Hot Ceremonial Matcha','[230]'::jsonb,'[]'::jsonb),
('Hot Series|Hot Flat White','Hot Series','Hot Flat White','[120]'::jsonb,'[]'::jsonb),
('Hot Series|Hot Cortado','Hot Series','Hot Cortado','[120]'::jsonb,'[]'::jsonb),
('Hot Series|Hot Matcha Latte','Hot Series','Hot Matcha Latte','[120]'::jsonb,'[]'::jsonb),
('Hot Series|Hot Choco Mallows','Hot Series','Hot Choco Mallows','[140]'::jsonb,'[]'::jsonb),
('Hot Series|Hot Spanish Latte','Hot Series','Hot Spanish Latte','[130]'::jsonb,'[]'::jsonb),
('Hot Series|Hot Dark Mocha','Hot Series','Hot Dark Mocha','[130]'::jsonb,'[]'::jsonb),
('Hot Series|Hot Salted Caramel','Hot Series','Hot Salted Caramel','[130]'::jsonb,'[]'::jsonb),
('Hot Series|Hot French Vanilla','Hot Series','Hot French Vanilla','[130]'::jsonb,'[]'::jsonb),
('Hot Series|Hot Hazelnut','Hot Series','Hot Hazelnut','[130]'::jsonb,'[]'::jsonb),
('Latte|Blueberry Latte','Latte','Blueberry Latte','[90, 110]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Latte|Strawberry Latte','Latte','Strawberry Latte','[90, 110]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Latte|Matcha Latte','Latte','Matcha Latte','[110, 130]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Latte|White Mocha Latte','Latte','White Mocha Latte','[165, 185]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Milk Tea|Red Velvet MT','Milk Tea','Red Velvet MT','[100, 120]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Milk Tea|Chocolate MT','Milk Tea','Chocolate MT','[105, 125]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Milk Tea|Classic MT','Milk Tea','Classic MT','[100, 120]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Milk Tea|Hokkaido MT','Milk Tea','Hokkaido MT','[100, 120]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Milk Tea|Matcha MT','Milk Tea','Matcha MT','[100, 120]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Milk Tea|Okinawa MT','Milk Tea','Okinawa MT','[100, 120]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Milk Tea|Wintermelon MT','Milk Tea','Wintermelon MT','[100, 120]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Fruit Tea & Soda|Apple Green Fruit Tea','Fruit Tea & Soda','Apple Green Fruit Tea','[100, 120]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Fruit Tea & Soda|Strawberry Fruit Tea','Fruit Tea & Soda','Strawberry Fruit Tea','[100, 120]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Fruit Tea & Soda|Apple Green Soda','Fruit Tea & Soda','Apple Green Soda','[100, 120]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Fruit Tea & Soda|Blue Lemonade Soda','Fruit Tea & Soda','Blue Lemonade Soda','[100, 120]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Fruit Tea & Soda|Blueberry Soda','Fruit Tea & Soda','Blueberry Soda','[100, 120]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Fruit Tea & Soda|Strawberry Soda','Fruit Tea & Soda','Strawberry Soda','[100, 120]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Frappe|Strawberry Matcha Frappe','Frappe','Strawberry Matcha Frappe','[210, 230]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Frappe|Dark Mint Frappe','Frappe','Dark Mint Frappe','[210, 230]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Frappe|Cookies & Cream Frappe','Frappe','Cookies & Cream Frappe','[210, 230]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Frappe|Biscoff Frappe','Frappe','Biscoff Frappe','[210, 230]'::jsonb,'["16oz", "22oz"]'::jsonb),
('Jelly Series|Mocha Jelly','Jelly Series','Mocha Jelly','[99]'::jsonb,'[]'::jsonb),
('Jelly Series|Coffee Jelly','Jelly Series','Coffee Jelly','[99]'::jsonb,'[]'::jsonb),
('Jelly Series|Choco Jelly','Jelly Series','Choco Jelly','[99]'::jsonb,'[]'::jsonb),
('Tea Bags|Lemon & Ginger Tea','Tea Bags','Lemon & Ginger Tea','[30]'::jsonb,'[]'::jsonb),
('Tea Bags|Mixed Berries Tea','Tea Bags','Mixed Berries Tea','[60]'::jsonb,'[]'::jsonb),
('Tea Bags|Green Tea','Tea Bags','Green Tea','[30]'::jsonb,'[]'::jsonb),
('Add-ons|Espresso Shot Add-on','Add-ons','Espresso Shot Add-on','[50]'::jsonb,'[]'::jsonb),
('Add-ons|Boba Add-on','Add-ons','Boba Add-on','[20]'::jsonb,'[]'::jsonb),
('Add-ons|Egg','Add-ons','Egg','[20]'::jsonb,'[]'::jsonb),
('Add-ons|Rice','Add-ons','Rice','[25]'::jsonb,'[]'::jsonb),
('Add-ons|Spam','Add-ons','Spam','[35]'::jsonb,'[]'::jsonb),
('Add-ons|Ham','Add-ons','Ham','[30]'::jsonb,'[]'::jsonb),
('Add-ons|Chicken Hotdog','Add-ons','Chicken Hotdog','[20]'::jsonb,'[]'::jsonb),
('Add-ons|Sea Salt Cream Cloud','Add-ons','Sea Salt Cream Cloud','[25]'::jsonb,'[]'::jsonb),
('Add-ons|Cold Cloud','Add-ons','Cold Cloud','[20]'::jsonb,'[]'::jsonb),
('Add-ons|Biscoff Biscuit','Add-ons','Biscoff Biscuit','[12]'::jsonb,'[]'::jsonb),
('Add-ons|Oatmilk','Add-ons','Oatmilk','[30]'::jsonb,'[]'::jsonb),
('Add-ons|Oreo Biscuit','Add-ons','Oreo Biscuit','[6]'::jsonb,'[]'::jsonb),
('Add-ons|Oreo Crumble','Add-ons','Oreo Crumble','[14]'::jsonb,'[]'::jsonb),
('Add-ons|Biscoff Crumble','Add-ons','Biscoff Crumble','[20]'::jsonb,'[]'::jsonb),
('Add-ons|Strawberry Cream Cloud','Add-ons','Strawberry Cream Cloud','[25]'::jsonb,'[]'::jsonb),
('Add-ons|Bacon','Add-ons','Bacon','[35]'::jsonb,'[]'::jsonb),
('Add-ons|Fries Powder','Add-ons','Fries Powder','[30]'::jsonb,'[]'::jsonb),
('Waffles|Plain Waffle','Waffles','Plain Waffle','[120]'::jsonb,'[]'::jsonb),
('Waffles|Biscoff Crumble','Waffles','Biscoff Crumble','[180]'::jsonb,'[]'::jsonb),
('Waffles|Oreo Caramel','Waffles','Oreo Caramel','[175]'::jsonb,'[]'::jsonb),
('Waffles|Choco Strawberry','Waffles','Choco Strawberry','[175]'::jsonb,'[]'::jsonb),
('Waffles|Spam & Egg','Waffles','Spam & Egg','[180]'::jsonb,'[]'::jsonb),
('Waffles|Tuna Spread','Waffles','Tuna Spread','[165]'::jsonb,'[]'::jsonb),
('Waffles|Ham & Cheese','Waffles','Ham & Cheese','[180]'::jsonb,'[]'::jsonb),
('Waffles|Chicken Hotdog','Waffles','Chicken Hotdog','[160]'::jsonb,'[]'::jsonb),
('Silog|Spamsilog','Silog','Spamsilog','[190]'::jsonb,'[]'::jsonb),
('Silog|Hamsilog','Silog','Hamsilog','[180]'::jsonb,'[]'::jsonb),
('Silog|Chickendogsilog','Silog','Chickendogsilog','[170]'::jsonb,'[]'::jsonb),
('Silog|Cornsilog','Silog','Cornsilog','[180]'::jsonb,'[]'::jsonb),
('Pasta & Fries|Pasta','Pasta & Fries','Pasta','[210]'::jsonb,'[]'::jsonb),
('Pasta & Fries|Solo Fries','Pasta & Fries','Solo Fries','[100]'::jsonb,'[]'::jsonb),
('Pasta & Fries|Barkada Fries','Pasta & Fries','Barkada Fries','[280]'::jsonb,'[]'::jsonb),
('Cold Brew|Cold Brew','Cold Brew','Cold Brew','[120]'::jsonb,'[]'::jsonb)
on conflict (key) do update set category=excluded.category,name=excluded.name,prices=excluded.prices,labels=excluded.labels;

-- Done. Next: Authentication > Users > Add user (the staff email above, with a password),
-- and turn OFF "Allow new users to sign up" in Authentication > Sign In / Providers.
