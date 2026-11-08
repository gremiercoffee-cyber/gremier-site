-- Refunds from the admin order card: money back through PayMe, then a חשבונית זיכוי from FinBot
-- linked to the order's tax invoice/receipt. One row per refund (several partial refunds per order).
-- Service-only table: the admin reads and writes it through the order-refunds function.
begin;
create table if not exists public.order_refunds (
  id uuid primary key,                       -- made by the admin page, so a double tap can't refund twice
  order_id uuid not null references public.orders(id),
  amount_minor integer not null check (amount_minor > 0),
  reason text,
  payme_sale_id text not null,
  -- refunding: sent to PayMe · refunded: PayMe confirmed · failed: PayMe refused (no money moved)
  -- needs_review: no clear answer from PayMe — check PayMe before doing anything else
  status text not null check (status in ('refunding','refunded','failed','needs_review')),
  payme_transaction_id text,
  payme_detail text,
  refundable_left_minor integer,             -- PayMe's sale_refund_buffer after this refund
  refunded_at timestamptz,
  -- not_needed: the order's document is a קבלה (before VAT) · pending: to issue · issuing: sent to FinBot
  -- issued · rejected: FinBot refused it (nothing created, can retry) · needs_review: unclear, check FinBot
  credit_status text check (credit_status in ('not_needed','pending','issuing','issued','rejected','needs_review')),
  linked_document_number text,
  credit_document_url text,
  credit_document_number text,
  credit_pdf_path text,
  credit_error text,
  email_requested boolean not null default false,
  email_sent_at timestamptz,
  email_error text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists order_refunds_order_idx on public.order_refunds(order_id);
-- Only one refund in flight per order.
create unique index if not exists order_refunds_one_in_flight on public.order_refunds(order_id) where status = 'refunding';
alter table public.order_refunds enable row level security;
revoke all on public.order_refunds from anon, authenticated;
commit;
