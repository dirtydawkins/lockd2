const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const homepage = fs.readFileSync(path.join(root, "index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "discovery.js"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase", "migrations", "20261028_0006_lockd_discovery_feed.sql"), "utf8");

test("homepage discovery feed has location, date, price and category controls with real-result sections", () => {
  for (const id of [
    "discover-feed", "open-location-picker", "clear-location", "discovery-category", "discovery-min-price",
    "discovery-max-price", "discovery-start-date", "discovery-end-date", "discovery-quantity", "discovery-guests",
    "nearby-listings", "available-listings", "recent-listings",
  ]) assert.match(homepage, new RegExp(`id="${id}"`));
  assert.match(homepage, /<script src="\.\/discovery\.js" defer><\/script>/);
  assert.match(script, /fetch\(`\/api\/listings\?/);
  assert.match(script, /fetch\("\/api\/nearby"/);
  assert.match(script, /search_lockd_available_listings|dates: true/);
});

test("geolocation is opt-in and precise coordinates are not placed in URLs or browser storage", () => {
  assert.match(script, /navigator\.geolocation\.getCurrentPosition/);
  assert.match(script, /\$\("#use-current-location"\)\.addEventListener\("click", useCurrentLocation\)/);
  assert.match(script, /Math\.round\(position\.coords\.latitude \* 100\) \/ 100/);
  assert.match(script, /localStorage\.setItem\(manualLocationKey, nextLocation\.label\)/);
  assert.doesNotMatch(script, /searchParams\.set\("(?:latitude|longitude)"/);
  assert.doesNotMatch(script, /localStorage\.setItem\([^\n]*(?:latitude|longitude)/);
  assert.match(script, /window\.location\.pathname\}\$\{window\.location\.search/);
});

test("location permission remains optional and manual locality matching is explicit", () => {
  assert.match(homepage, /Use my current location/);
  assert.match(homepage, /Choose a location manually/);
  assert.match(homepage, /Not now/);
  assert.match(script, /location_label|location: location\.label/);
  assert.match(script, /permission was declined\. Choose a town or neighbourhood manually/);
});

test("nearby search migration keeps coordinates private and uses real publication state", () => {
  const publicGrant = migration.match(/grant select\s*\(([\s\S]*?)\)\s*on public\.lockd_listings/i)?.[1] || "";
  assert.match(migration, /create or replace function public\.search_lockd_nearby_listings/i);
  assert.match(migration, /l\.listing_status = 'published'/);
  assert.match(migration, /l\.approval_status = 'approved'/);
  assert.match(migration, /l\.location_latitude is not null/);
  assert.match(migration, /where l\.owner_id = auth\.uid\(\)/);
  assert.match(migration, /round\(p_location_latitude::numeric, 2\)/);
  assert.doesNotMatch(publicGrant, /location_latitude|location_longitude/);
  assert.doesNotMatch(migration, /set published_at\s*=\s*created_at/i);
});
