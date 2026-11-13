-- Collection: a "skip" status (figures you don't want, left out of the totals)
-- and what you paid: unit price, quantity, optional purchase date.
alter table collection drop constraint if exists collection_status_check;
alter table collection add constraint collection_status_check check (status in ('owned', 'wishlist', 'skip'));
alter table collection add column if not exists price numeric(12, 2) check (price is null or price >= 0);
alter table collection add column if not exists qty int not null default 1 check (qty >= 1);
alter table collection add column if not exists bought_on date;
