# Pop-up event shop: template

First used for **ELLE Fitness** (Wed 18 Nov 2026, 09:30–13:00). The code stays in the site and switches
itself off when the event's hours end, so the next pop-up only needs new settings, not new code.

## What it does

- A banner under the homepage video ("The <event> pop-up · Shop <event> products") shows only during
  the event's hours. Tapping it opens the event's own shop (a sheet on the homepage).
- Direct link for a QR code: `https://gremiercoffee.co.il/#elle` (or `?elle=1`).
- The shop lists the event's products, including ones hidden in the main shop, with the discount already shown.
- **No code at all.** Ordering from the event shop is what gives the price, pick-up and reward. The coupon row
  is only internal settings: typed in by hand the code says "not found" (validate-coupon and create-website-order
  need `event_shop: true`, which only the event shop sends). Checkout hides the code box and shows "<event> discount".
- The event's items are **picked up at the event**, so there's no address or shipping. If the cart also has
  other products, those are delivered, and delivery is charged on them only (checkout shows the split).
- Once paid, an event-only order is marked **fulfilled** with no delivery card or job
  (`_shared/pending-delivery.ts`). A mixed order's delivery carries only the delivered items.
- Optional reward: orders paid during the reward hours get a personal single-use code for the next
  order by email (for example `ELLE-K7P2Q`, 10% off, valid 30 days).

## Files

| File | Role |
|---|---|
| `storefront-elle.js` | banner + event shop + automatic code. **Settings are the `EV` line at the top.** |
| `storefront-elle.css` | banner and shop styles |
| `index.html` | loads the two files above (bump `?v=` after edits); checkout pick-up/delivery split; event price labels |
| `supabase/functions/validate-coupon` | `catalog:true` returns the event's products |
| `supabase/functions/create-website-order` | allows hidden event products, no fee on event items, delivery fee on the rest |
| `supabase/functions/_shared/event-reward.ts` | next-order reward, called from `fulfill-paid-order.ts` |
| `supabase/migrations/20261118010000_coupon_event_reward.sql` | event columns on `coupons` |

## Running the next pop-up

1. **Make the event coupon** (Supabase SQL; times are UTC, so Israel winter time is UTC+2 and summer time is UTC+3):

   ```sql
   insert into coupons (code, discount_type, discount_value, applies_to, product_ids, is_active,
                        waive_shipping, free_delivery, event_name, starts_at, expires_at,
                        reward_percent, reward_from, reward_until, reward_days, description)
   values ('NEXTEVENT', 'percent', 10, 'specific_products',
           array['<product id>', '<product id>']::uuid[],   -- the products to sell there, in display order
           true, true, false, 'Next Event Name',
           '2027-01-10 07:00Z', '2027-01-10 15:00Z',          -- code valid from / until
           10, '2027-01-10 08:00Z', '2027-01-10 11:00Z', 30,   -- reward % / reward hours / days valid (null percent = no reward)
           'Pop-up: Next Event Name');
   ```
   Check the column types against the ELLEFITNESS row first (`select * from coupons where code='ELLEFITNESS'`).
   Copy that row's settings if unsure.

2. **Point the site at it.** In `storefront-elle.js`, change the `EV` line: `code`, `name`, and the
   banner's `from` / `until` times (UTC). Then bump `storefront-elle.js?v=` in `index.html`.
3. **Preview** at `/?elle=preview#elle` (works any time), take phone screenshots for the organizers, and
   commit + push (Cloudflare Pages deploys `main`).
4. The banner turns itself off when `until` passes; nothing to undo afterwards.

## Ideas to make it broader later

- Read the banner times and event name from the coupon row, so step 2 disappears.
- Rename `elle` (file names, `#elle` link) to something generic like `popup`.
- Choose pickup vs. delivery per event (for example an event that ships everything).
