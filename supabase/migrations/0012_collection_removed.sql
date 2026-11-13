-- Collection: "removed" status = figure deleted from your checklist (hidden, left out of
-- every total, restorable from the Removed filter).
alter table collection drop constraint if exists collection_status_check;
alter table collection add constraint collection_status_check check (status in ('owned', 'wishlist', 'skip', 'removed'));
