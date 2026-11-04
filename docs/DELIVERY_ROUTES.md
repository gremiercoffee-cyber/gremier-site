# Delivery routes (Navigate button)

Admin → Deliveries → **🧭 Navigate** opens a planner. Pick deliveries (none are pre-selected),
add extra stops, choose a start and a finish, and press **Open in Google Maps**. Maps opens
in route preview with the stops loaded. You reorder them in Maps. Nothing in the app changes
when you open Maps: no status changes, nothing is saved.

## Pieces

| File | What it does |
|---|---|
| `address-picker.js` | One address picker used at checkout, in admin scheduling, and in the planner (extra stops, start, finish). |
| `supabase/functions/places` | Server proxy to Google Places API (New). The key never reaches the browser. |
| `admin-route.js` | The planner, plus building the Maps link. |
| `supabase/functions/_shared/delivery-address.ts` | Checks the address data a website order sends. |
| migration `20261104200000_delivery_locations.sql` | Adds `jobs.delivery_location` and `jobs.delivery_details`. |

## Where the data lives

- **What the customer typed** stays where it always was: `orders.delivery_info.address` (plus `address_entered`). For jobs it stays in `private_address` / `cb_address`. Nothing existing is rewritten.
- **The navigation point:**
  - Website orders keep it in `orders.delivery_info.address_place`. Jobs keep it in `jobs.delivery_location`.
  - It is either a Google **place ID** or a location confirmed by hand (current location or a pasted Maps link).
  - Google allows storing place IDs indefinitely. The Google address label is stored with its timestamp (`at`) only so you can recognise it. Maps always navigates by the place ID.
- **Apartment, floor, entrance, instructions** are kept in `address_details` / `jobs.delivery_details`. They show in admin and the planner but are **never put in the Maps link**.
- **"Needs review":** an address with no usable location shows in the planner as needs-review, with a **Fix address** button, and is never guessed.
  - "Usable" means a building-level Google match, an approximate match you confirmed, a confirmed pin, or a store's saved coordinates.
  - Fix address saves only to the job (`delivery_location`), never to the customer's order.

## Maps link rules

- Uses the official `https://www.google.com/maps/dir/?api=1` URL with `travelmode=driving`, plus `origin` / `destination` / `waypoints` and their `*_place_id` versions.
- `waypoint_place_ids` is only sent when every waypoint has a place ID. There is no `dir_action=navigate`, so Maps opens in route preview and you can reorder.
- **Limit:** 9 stops after the start, or 8 if the route finishes back at the start or at a separate end point. Above that the planner shows an error and won't open Maps. Stops are never dropped silently.
- **On Android**, the link opens the Google Maps app directly (`intent://` to `com.google.android.apps.maps`).
  - If the app isn't installed, a mobile browser only takes 3 middle stops.
  - So with more than 3 middle stops, the fallback comes back to the admin with a message instead of opening a cut-down route.

## Configuration still required (Google Cloud)

1. In Google Cloud Console, pick or create a project and **enable billing**.
2. Enable **Places API (New)** (`places.googleapis.com`). The legacy Places API is not needed, and neither is the Maps JavaScript API.
3. Create an API key. Under **API restrictions**, restrict it to **Places API (New)** only.
   - It is a server key, called from Supabase Edge Functions, so there is no HTTP referrer to restrict.
   - Edge Functions don't have fixed IPs, so leave the application restriction as "None" and rely on the API restriction plus quotas.
4. Optionally, set a daily quota cap on Places API (New) to limit cost.
5. Save the key as a Supabase secret on project `ayuzmwpmhncxrugsyxmw`:
   ```bash
   npx supabase secrets set GOOGLE_PLACES_API_KEY=... --project-ref ayuzmwpmhncxrugsyxmw
   ```
   Use the gremiercoffee token per command, as in the global instructions.

Until the key is set, the picker shows "address lookup unavailable". Checkout still works, and those orders show as needs-review in the planner.

**What each lookup costs:** autocomplete requests a session token, and so does the details call that ends the session, so a search is billed as one session. The FieldMasks request only the fields we use:
- Autocomplete: `placeId` and `structuredFormat`.
- Details: `id`, `formattedAddress`, `types`, `addressComponents`.

**Search area:** results are limited to region codes `il` and `ps`, and biased to a 50 km circle around 31.74, 35.08. That circle covers Beitar Illit, Jerusalem and Beit Shemesh.

**Attribution:** "Powered by Google" is shown under the suggestions, as required when suggestions are not shown on a Google map.

## Deploy order (only after approval)

1. Migration `20261104200000_delivery_locations.sql`. It must come before step 2, because `pending-delivery.ts` writes the new columns.
2. Functions:
   - `places`
   - `create-website-order`
   - every function that imports `_shared/pending-delivery.ts` (find them with `grep -rl pending-delivery supabase/functions`)
3. Site (push to main → Cloudflare Pages).

## Checks once the key is set

- At checkout, type "בית"/"Beitar" and confirm Beitar Illit streets appear. Do the same for a Jerusalem street and a Beit Shemesh street, in both Hebrew and English.
- Choose a suggestion, then edit the text. The place must clear and checkout must ask you to choose again.
- On an Android phone, open the admin → Navigate, pick 2–4 deliveries, then Open in Google Maps. The Maps app should open in preview with all stops, and with no apartment or floor in the destination.
