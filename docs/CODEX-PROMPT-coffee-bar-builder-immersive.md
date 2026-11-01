# Coffee Bar Builder: make it its own immersive world

You're working on gremiercoffee.co.il (a static site on Cloudflare Pages; pushing to `main` deploys).
Read this whole brief before starting. Work on the Coffee Bar Builder only: don't change pricing,
booking, the hero, or other pages.

## Goal

When a customer taps **"Start building your coffee bar"**, it should feel like they leave the website
and step into a place of its own: a warm, quiet coffee-bar room where they put their bar together.
Think of how a video app takes you into a full-screen player: the page steps back and a new
environment takes over. It must **not** feel like a stage, a show or a spotlight. It should feel like
being inside a cosy café at golden hour, building your bar on the counter. Keep everything subtle
and premium.

## Where things are

- `storefront-planner.js`: the builder. Key parts:
  - `building`, `bstep`, `prevStep`, `openUp`, `shownStep`, `window.plannerStart(to)`. Start pushes a
    history entry `{ bbBuild: true }`; `popstate` closes the builder.
  - `render()`: when building, fills `#planner` with `.bbx-top`, `.bbx` (`.bbx-scene.bb-tray` with
    `sceneHtml(plan)` and `.bbx-price`, plus `.bbx-panel.bb-qs` with `stepHtml(...)`), and the
    "all our coffee" picker (`pickerHtml()`). When not building, it shows `introHtml()` (the start card).
  - Steps: `guests` → `bar` → (`opt-coffee` → `opt-milk` → `opt-extras`) → `delivery`.
    `goStep(to)` changes step and scrolls to the top.
  - `reconcileScene(previous, next)` keeps scene items and animates additions and moves. `layoutScene()`
    fits the scene. `animateTotal()` counts the price. `mini()` / `syncMini()` handle the floating thumbnail,
    which is off in builder mode.
  - `window.plannerOrder()` books: it fills the product drawer silently, adds to cart and opens checkout.
    It must keep working unchanged.
  - Tiles: `photoTile(...)`, `coffeeHtml` (jerry-can grid), `milkHtml`, `syrupHtml`, `lidsHtml`,
    `takeHomeHtml` / `homeCard` / `pickerHtml`.
- `storefront-bar-scene.css`: all builder styles (search `.bbx`, `.bb-jug-tile`, `.bbx-cta`,
  `.bbx-options`, `.bbx-sheet`).
- `storefront-bar-chat.js`: the chat bubble (`#barChat`). It shows when `body.bb-builder-on`, which is
  set when `#coffeebarsPage` has `.bb-building`.
- `storefront-nav.css`: the button colour variables `--gremier-grad` / `--gremier-grad-hover` (mostly
  black with a warm amber glow at one edge). Reuse them.
- `index.html`: script and stylesheet tags carry `?v=YYYYMMDD-N`. **Bump the version of every file you
  change**, or browsers keep the old copy.

## What to build

### 1. The way in: an expanding dark circle
- On "Start building your coffee bar", a circle of deep espresso (`#120d0a`, with the brand's warm
  edge glow) grows from the button's position until it covers the screen. Use `clip-path: circle()`
  or a scaled element, about 450–550 ms, ease-in-out.
- Behind it, the builder overlay mounts. Then the circle fades into the builder's background, so it
  feels like the button opened a door.

### 2. The world: a subtle, warm coffee-bar room (not a stage)
- **Background:** deep warm brown-black, with a very soft ambient warm light, like late-afternoon light
  in a café. Use a large, low-contrast radial gradient from one side plus a gentle vignette. Optionally
  add a barely visible texture, like the paper grain of the opening logo graphic in
  `hero/00-intro-wide.webp`. No spotlight cone, no stage lights, no "showtime" feel.
- **The bar scene:** still the focus, sitting naturally in the room, slightly lit so it reads clearly.
  When the builder opens, the scene settles in gently (a soft fade with a small rise). Items keep their
  existing drop-in and move animations; give a new item a tiny bounce as it lands on the counter.
- **Cards and tiles:** question cards become dark, slightly translucent "glass" panels (warm dark
  surface, a thin warm border, soft blur behind). Text is off-white. Tiles (`.bb-jug-tile`) become dark
  with amber outlines when selected. Counts and badges keep the brand colour. Check contrast: body text
  at least 4.5:1.
- **Price:** when it changes, it glows softly amber for a moment while counting.
- **Moving between steps:** keep the current fade (no sliding). Add a very slight shift of the
  background light, as if the camera moves a little in the room. Keep it subtle.
- **Optional:** faint warm dust motes drifting slowly in the light, very low opacity, few particles,
  stopping when the tab is hidden. Skip this if it doesn't look tasteful.

### 3. The frame: popping off the page
- **Desktop and tablet:** the builder is an overlay floating about 24px from each edge, with large
  rounded corners and a deep soft shadow. The website behind shrinks slightly (scale about 0.96), dims and
  blurs, so the builder looks like it's lifting off the page.
- **Phones:** full screen, edge to edge. Hide the site's header and bottom tab bar while the builder is
  open.
- **The builder's own slim top bar:** ✕ close (left in English, right in Hebrew), the step progress
  dots, and the live price. Remove the old `.bbx-top` row.
- Layout inside stays as now: scene and questions side by side on desktop, stacked on phones, with the
  scene pinned while scrolling on phones.
- The overlay scrolls on its own; the page behind must not scroll (lock body scroll while open).
- The chat bubble lives inside the overlay, bottom corner, on the side opposite the scene (opposite the
  scene on desktop, bottom-left on phones), and keeps working.

### 4. The way out
- ✕, the phone's Back button, and Escape all close the builder with the reverse animation: the circle
  shrinks back into the start button. The customer lands on the Coffee Bars page, with their choices
  kept (state is in memory; keep that).
- Booking (`plannerOrder`) opens checkout from inside the overlay. Make sure the checkout and the product
  drawer appear above the overlay (z-index) and nothing jumps back to the old page first. After checkout
  closes, the builder is still there.

### 5. Must keep working
- Every step, button and tile: guests chips, "See my coffee bar", "Show me more options", the jerry-can
  grid with stations, milk tiles, syrup and lid tiles, delivery (event / before / pickup with dates), the
  take-home strip and the "See all our coffee" picker, Book, Share, and the chat.
- Hebrew (RTL): mirror positions correctly (close button, chat bubble, the glow side).
- `prefers-reduced-motion`: no circle animation, no light shift, no motes; open and close with a quick fade.
- Shared links (`?bar=…`, and `?bar=…&go=checkout`, which goes straight to checkout) and `window.openCoffeeBarBuilder()` open straight into the builder.
- No horizontal scrolling on a 375px-wide phone. Nothing hidden under the phone's notch or home bar
  (use `env(safe-area-inset-*)`).

## How to check your work
1. Run the site locally (there's a `static-site` config in `.claude/launch.json`: `npx serve -l 8123 .`)
   and open `/#coffeebars`.
2. Test at 375×812 (phone) and 1280×800 (desktop), in English and Hebrew (the globe button switches
   language).
3. Go through every step to delivery; add take-home items via the strip and the picker; press Book and
   confirm the product drawer prices the bar exactly as the builder total (it falls back to showing the
   drawer if the prices differ). Don't complete a real payment.
4. Test ✕, Back and Escape, a shared link, and reduced motion (DevTools rendering emulation).
5. Check the console for errors.

## Delivery
- Keep the code style of the surrounding files (compact, short comments explaining why).
- Commit with a clear message, bump the `?v=` versions in `index.html`, push to `main`, and confirm the
  live site serves the new versions.
- Write a short summary of what you built, anything you skipped, and screenshots (phone and desktop) of
  the entrance, a step, and the exit.
