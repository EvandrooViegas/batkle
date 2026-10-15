# Developer API

The public REST API at `/api/v1` has one endpoint for now: `POST /v1/posts`. A developer describes a post (or a carousel) as JSON, with its size, background and nodes, and the API answers with the rendered image. The docs for developers are the `/developers` page; this file is for whoever maintains the API.

| Piece | Where |
|---|---|
| Routing, keys, charging, the response | `lib/developer/api.ts`, mounted by `app/api/v1/[[...path]]/route.js` |
| The request document, its checks, and editor designs → requests | `lib/developer/document.ts` |
| Loading images and rendering slides | `lib/developer/render.ts`, which calls `renderCanvasToPng` in `lib/renderCanvas.js` |
| Credit costs, rate limit, starter credits | `lib/developer/pricing.ts` |
| Keys, balances, usage, rate-limit counters (MongoDB) | `lib/developer/store.ts` |
| Dashboard API, signed-in session (`/api/developer`) | `lib/developer/dashboard.ts` |
| Docs page, its reference data and example images | `app/developers/page.js`, `components/developers/DeveloperDocs.jsx`, `apiReference.js`, `public/developers/examples/` |
| Dashboard (`/developers/dashboard`) | `components/developers/DeveloperDashboard.jsx` |
| The editor's API tab (a design as a request) | `components/editor/ApiPanel.jsx`, using `toApiDocument` |

## The document

- A body has `width`, `height`, `background`, and either `nodes` (one post) or `slides` (a carousel of 2 to 10). `slide: n` renders one slide of a carousel.
- Nodes are the editor's four layer types: `text`, `image`, `shape` and `gradient`. `readPostDocument` checks every property and turns the document into the renderer's canvas nodes. An unknown property is a 400 error that names it, and suggests a spelling when only the case differs.
- **Text spans** (`text` as an array) become the renderer's inline tags (`<%inline:color=…|fontWeight=…:words%>`). Tag markers typed in plain text are broken with a zero-width space, so callers can't inject tags.
- **`verticalAlign`** is an API property the renderer reads first. Saved designs don't have it and keep the old placement: centred text in the middle of its box, right-aligned text at the bottom. `toApiDocument` writes that placement out explicitly.
- **A gradient background** becomes a full-size gradient node under the others.
- **`toApiDocument(canvas, origin)`** turns a saved editor design into a request body. Classes and inline tags become spans; `/api/uploads/…` images get the site's origin; hidden nodes are left out. Groups are not exported: the saved x/y positions are used as they are.

## Rendering

- Every image is loaded by `render.ts` before rendering and handed to the renderer as a data URL, so the renderer never downloads anything for the API.
- **Images from the web:** they must be on a public host. The resolved addresses are checked against private, loopback and link-local ranges, redirects are followed by hand (at most 3) and each hop is checked again. Only PNG, JPEG, WebP, GIF and AVIF are accepted, up to 10 MB, with a 15 s timeout.
- **`/api/uploads/<id>`** (or the same path on the site's origin) is read from the `uploads` collection, which is how designs exported from the editor keep their images.
- An image that can't be used fails the request with `422 image_unavailable` and its reason. Nothing is charged.
- Slides render one after another. One image comes back as `image/png`; several come back as `application/zip` (`slide-01.png`…, stored uncompressed). The body is streamed, because Vercel limits buffered function responses to 4.5 MB.
- **Nothing is stored:** the `renders` collection is not used by the API, so API traffic doesn't count against the database quota.

## Credits and limits

- 1 credit per rendered image (`CREDIT_COSTS.image`). Credits are taken after the body is checked and before rendering, and refunded in full when rendering fails.
- New accounts start with `DEVELOPER_FREE_CREDITS` (100 when unset). Add credits with `node scripts/grant-credits.cjs <email> <credits> ["note"]` until credit packs can be bought.
- 60 requests a minute per key (`apiRateLimits`, a per-minute counter with a TTL index).
- Each authenticated request writes one `apiUsage` record (status, credits, duration, key, slide count and size), kept for 90 days. The dashboard aggregates them by day in the viewer's time zone.
- `POST /api/render`, the editor's download and preview, needs a session and the caller's own post. It is free and does store a render.

## Example images

`public/developers/examples/*.png` are the documents in `components/developers/apiReference.js` (`EXAMPLES`), rendered by the API itself and scaled to 540 px wide. When an example changes, render it again through `POST /v1/posts` (carousel slides one at a time, with `slide`) and replace the file.
