begin;
alter table public.revenue_classification_overrides drop constraint revenue_classification_overrides_category_check;
alter table public.revenue_classification_overrides add constraint revenue_classification_overrides_category_check check(category in ('coffee_bar','coffee','stores','other'));
commit;
