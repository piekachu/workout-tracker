-- Collection: fixed categories + franchise ("series") + your own category per figure.
--   * the 9 fixed categories (Classics, Classics Revive, SP, # Series, # Series Selection,
--     # Plus, CORE, EX, SB) and each catalogue figure's franchise come from catalog.json
--   * collection_edits.cat / collection_added.cat now hold YOUR OWN category for the figure
--     (names live in collection_cats); fr = franchise correction; base_cat = fixed category of
--     a figure you added yourself.
alter table collection_edits add column if not exists fr text;
alter table collection_added add column if not exists fr text;
alter table collection_added add column if not exists base_cat text;
