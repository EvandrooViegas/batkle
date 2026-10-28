# Design Study and editable generation

A **Design Study** is a visual language, not a set of templates. It answers "what makes these designs look like one family?" and lets the system compose many different layouts in that language.

```
CONTENT + DESIGN STUDY + BRAND → composition planner → Canvas document → deterministic validation/fit → editable post
```

There are three layers:

- **Design Study** (`globalDesignFamilies` / `globalDesignVersions`, `family.study`) — the visual language:
  - composition, hierarchy, typography behaviour
  - colour *roles*, contrast
  - imagery strategy
  - spacing and density
  - decorative language
  - branding placement
  - recurring rules, flexible rules and anti-patterns
- **Brand** (`flows.brandContext`) — actual colours, fonts, logo and assets.
- **Content** — headline, body, CTA, labels.

## The study

`studySchema` (`lib/designs/global/types.ts`) has two halves:

- **Prose** explains the language to people and to the planning model. These fields are `personality`, `composition`, `typography`, `colorContrast` / `colorRoles`, `imagery`, `spaceDensity`, `decorative`, `hierarchy` and `logoPlacement`. Three existing fields carry the rules:
  - `familyRules` = **recurring rules**
  - `variantRules` = **flexible rules**
  - `avoid` = **anti-patterns**
- **`grammar`** is what the composition planner reads. It holds relationships and constraints, never coordinates:

| Grammar field | Meaning |
|---|---|
| `compositions` | Composition moves the language allows: `statement`, `stacked`, `split`, `image-led`, `backdrop-type`, `list`, `closing` |
| `headline`, `body`, `emphasis` | Scale, weight, case, tracking, leading; accent treatment (`color`, `background` marker, `underline`) |
| `alignment`, `anchors` | Allowed alignments and vertical copy anchors, dominant first |
| `margin`, `density` | Spacing behaviour |
| `surfaces` | Surface roles (`dark`, `light`, `brand`), dominant first |
| `decorations` | Decorative vocabulary: `oversizedType`, `ring`, `circle`, `arc`, `line`, `dotGrid`, `pill`, `cornerBlock`, `frame`, `glow`, each with scale, opacity, colour role and frequency |
| `imagery` | Scale, positions, shape, overlap, dominance, overlay, frequency |
| `branding`, `cta` | Logo, slide number and website placement; CTA style |

Every grammar field tolerates partial model output. An unknown value falls back to a default and never discards the study.

`study.imagery.mode` is one of `none`, `background`, `fullBleed`, `cutout`, `contained`, `collage`, `mixed`, `other`. Imagery comes from the study, not from Brand Personalization.

**Reference reconstructions** (`family.variants`, ids `reference-N`) are kept as review evidence: how the importer read each reference. Generation never selects or fills them. A reconstruction that fails validation is dropped; it never fails the study.

Families saved before grammars existed (and the bundled seeds before version 3) get a grammar **derived in code** from their reconstructions (`deriveGrammar` in `study.ts`). `reconcileStudy` stores a complete grammar whenever a draft is saved.

## Study creation (`lib/designs/global/analyze.ts`)

- **One Groq multimodal call per batch** of references (at most `GROQ_DESIGN_VISION_MAX_IMAGES`, default 3). One or more references are accepted.
- **Every request fits the model's input-token limit** (`GROQ_DESIGN_VISION_INPUT_LIMIT`, default 7000, the on-demand limit for `qwen/qwen3.8-27b`).
  - Measured on that model: each image costs ~1,794 input tokens regardless of its size (the model rescales internally), and the instructions are ~1,650 tokens. Downscaling saves nothing, so images are sent at full quality and the batch size is the only lever: two references per request fit 7000 (a measured two-reference request is 5,281 tokens).
  - Estimates use 3.5 characters per text token and `GROQ_DESIGN_VISION_IMAGE_TOKENS` (default 1800) per image. Each successful call refines a bounded correction from the token count Groq reports.
  - If Groq still answers 413 "Request too large", its reported limit is learned and the batch is retried once with fewer references. A 413 is rejected before processing, so nothing is spent.
  - Limits apply per Groq organization, so a second API key from the same organization does not raise them; keys from separate accounts only help with per-minute waits between batches.
- **At most one text-only repair** when the output is invalid. Images are never resent.
- `reconcileStudy` then completes the grammar and removes literal hex colours from the study text.
- `referenceStyle` and `typography.*Fallback` are used only for unbranded library previews.

### Measured from the pixels (`lib/designs/global/referenceMetrics.ts`)

Vision models misread some layout facts, for example reading centred copy as left-aligned, or an outlined box as "a thin rule". After the model call, each reference is measured in code, with no extra AI call:
- **Copy alignment:** from the edges of its text lines.
- **Boxes:** an outlined rectangle in a saturated colour that encloses text.
- **Rules:** thin separator lines that are not a box's edges.
- **Coloured copy:** whether any text is set in the accent colour.

`applyReferenceMetrics` then corrects the study:
- **Alignment** is set when the measured references agree; references that could not be measured follow them.
- **Headline box:** `grammar.headline.frame` is set, and each reference records whether it has one (`references[].frame`). Only slides that follow a boxed reference (the cover follows the first) get the box.
- **Highlight colour:** removed when no reference sets copy in colour.
- **Line decorations:** removed when they were really box edges.
- **Prose:** recurring rules and anti-patterns that contradict the measured alignment are dropped.

## Post generation

| Stage | Request | Model calls |
|---|---|---|
| Plan | `POST /api/plan-post` | 1 Groq completion for copy and composition plan together (a 2nd only if the output fails validation). Zero when existing copy is re-planned. |
| Visuals | `POST /api/resolve-assets` | Only for slides whose composition carries imagery. At most one OpenAI image generation per cutout slide, and none when a saved cutout fits. |
| Compose + validate | `POST /api/design-canvas` | None. |

### Plan

`studyForPlanning` sends the prose, rules, imagery strategy and allowed compositions. It never sends coordinates or reference images.

For each slide the model returns:
- a `composition`
- emphasis words
- an image subject plus stock queries (photos), or an isolated subject (cutouts)
- for cutout studies, optionally `reuse`: a saved gallery cutout that fits the slide

`sanitizeDesignPlan` removes invalid choices:
- compositions the study does not allow
- images on typographic compositions or no-imagery studies
- emphasis words that are not in the headline
- `reuse` refs that were not offered, or a cutout reused twice in one post

### Imagery: photographs and AI cutouts

AI-generated transparent cutouts are the preferred imagery, except in photo-led studies (`familyPhotoLed`: background imagery, or full-bleed photos that fill the frame). Those keep photographs, because a cutout cannot recreate a full-canvas photo. Otherwise `planSlides` decides per slide, deterministically:
- **Cutout-only studies** (`grammar.imagery.cutout: "always"`, the editor's *AI cutouts only*): every image is a cutout.
- **All other studies:** about one image in five (`STOCK_SHARE = .2`) stays a stock photograph; the rest are cutouts.
- `familyCutouts` reads the study's setting. Older studies without it are read from their imagery prose.
- The plan describes every image as one isolated subject, plus stock queries for the photo case.

AI images are only ever transparent PNG cutouts:
- **Cutout slides:** the resolver uses the gallery cutout the plan chose, else a saved cutout that matches the subject (`findGeneratedAsset`), else exactly one OpenAI generation with `background: "transparent"`. The canvas shape follows the target area (portrait, landscape or square).
- **AI unavailable:** OpenAI image calls run at most two at a time. A rate limit is retried once after the wait OpenAI asks for (up to 20 s). An account with no credits stops further calls for 5 minutes and shows a notice in Creation. When OpenAI cannot make the image, the fallbacks are tried in order; providers without a key are skipped:
  1. **fal** (`FAL_KEY`, FLUX schnell).
  2. **Pollinations** (`POLLINATIONS_API_KEY`, FLUX).
  3. **Stock:** Pexels or Unsplash, searched as "… isolated white background".

  fal and Pollinations draw the subject on a plain studio backdrop with a short prompt (`studioPrompt`). Their output is kept as an inline image, since fal links expire. `prepareSubjectAssets` cuts the result out locally, so it is still a transparent AI cutout and is saved to the gallery. A stock photo is cut out the same way. A photo that could not be cut out is never placed as a cutout. The slot's warning lists each provider that failed and which one was used.
- **Photo slides:** a photo the user attached to the idea, else Unsplash/Pexels. A photograph is never generated. When no photo fits, a global-design slot (`cutout_fallback`) uses a transparent cutout instead and is composed as one.
- **Saving:** a new cutout is saved to the brand's `assets` (the Gallery) with its description and tags, but only a good one (`isGalleryCutout`): the background came off and the subject is not cut by the image's left, right or top edge. The gallery holds nothing else; nobody uploads to it. The next plan lists up to 24 of them; new subjects are preferred and a post reuses at most one. The editor's *Gallery* source inserts or replaces images from the same gallery.
- **Composition:** a cutout keeps its proportions and stands on the lower edge of its area. It never sits behind the copy like a background photo; a full-frame position becomes the lower band. No overlay or mask is applied.
- **Empty space:** `globalLayoutPlan` dry-runs each text slide (statement, list, closing). If its copy leaves an empty band of at least 22% of the height above or below it, the slide gets a fill cutout of its planned subject there. The plan gives every slide a subject for this. The copy never moves. The cutout is fitted at render time into the band the real copy leaves: on the bottom edge below the copy, or just above the headline, on the side away from the text. A fill cutout that could not be made is simply left out.
- **No image at all:** if nothing could be found or generated, the slide is composed with the study's typography and the reason is added to the canvas warnings, instead of failing the post.

### Compose (`lib/designs/global/compose.ts`, deterministic)

`planSlides` picks, for each slide:
- **Composition:** the plan's choice, or a deterministic choice. Covers, list-like content and closings get suitable moves. Consecutive slides avoid repeating, and the least-used move is preferred.
- **Imagery:** whether the slide has an image, following the study's frequency.
- **Placement:** alignment, anchor, image position and surface role.

`composeSlide` then builds the slide:
- **Brand roles:** dark, light, accent and on-accent colours come from the brand (`brandPalette`).
- **Headline box:** `grammar.headline.frame` draws a rectangle around the headline: `outline` (border in the accent) or `solid` (accent panel, solid lettering). Its padding is part of the headline's measured block.
- **Text:** copy is measured and fitted as a group. Complete copy is never cut; text that cannot fit fails with a clear error.
- **Images:** placed in a deterministic frame (`imageFrame`). The asset planner uses the same frame for its briefs.
- **Decorations:** placed on the sides the copy leaves free.
- **Branding:** slide number and logo go where the study puts them. The logo always sits in a corner: a centred position moves to the left corner, and no logo tile is drawn inside the copy. A study that places no branding at all still gets the logo (or the brand name) top-left. A brand with a logo shows the logo instead of its website link (in the link's place when the study has no logo position). The logo version is chosen by contrast with the slide: the original artwork when it reads, otherwise its white or black silhouette (`inkLightness` is measured when the variants are generated). Brands without a logo show their name and website link.
- **CTA:** a slide shows only its own CTA, and the copy leaves it empty unless the post calls for an action. Nothing on an Instagram graphic is clickable, so CTAs are Instagram actions (save, share, comment, message, follow, link in bio); web-button wording such as "Saiba mais" or "Learn more" is removed in code.

Every output node is an independent, editable Canvas node (`text`, `shape`, `image`, `gradient`) with a `designRole`.

### Lists

A slide with 3–6 items becomes a designed list (the study's markers, and cards when its containers use them), whatever composition was proposed. `listParts` reads explicit arrays, numbered or bulleted lines, and enumerations written as a sentence ("Descubra cada fase: Descoberta, Estratégia, Implementação e Optimização"). The text before the colon stays as the intro line. When space is short, the headline gives up room first; then markers, padding and item text scale down together. The copy prompt asks for steps, phases and tips as separate lines.

### Build fallback

If copy does not fit, optional ornaments (logo badge, callout card) are dropped first, then a calmer composition with the same imagery decision is tried before failing (`renderGlobalPost`).

### Validate

`validate.ts` checks for:
- unsupported nodes and invalid geometry
- missing images
- canvas overflow
- minimum type size
- contrast and text collisions (oversized backdrop type is exempt from the collision check)

It corrects small problems and rejects real overflow. There is no AI repair.

Each AI call logs `[ai-call] service=… model=… purpose=… referenceImages=…`. Count these per generation to audit usage.

## Library UI

- The admin page shows the reference images and four sample compositions generated from the study.
- The study itself is editable (prose, grammar controls, rules).
- Reconstructions and the raw grammar JSON sit in a collapsed *Advanced* section.
- There are no variant names, roles or template routes.
- Brand pickers preview the same four sample beats in the brand's identity.

## Fonts

- **Loading:** previews and the editor load every Google font a canvas uses (`components/useCanvasFonts.js`), one request per weight. Google rejects a whole request that names a weight the family lacks, so one bad weight can't block the rest.
- **Measuring:** the editor measures text heights only after the fonts have loaded. In a composed slide, a copy block that measures taller than planned pushes the copy below it down instead of overlapping it.
- **Weights:** fonts published in one weight (Anton, Bebas Neue, Impact…) are set at that weight, so the browser never fakes a wider bold.
- **Export:** PNG export fetches brand Google fonts from Fontsource by name. System fonts such as Impact are not published there and export as Inter.

## Limits

- Text measurement is estimated, not browser-measured. Condensed and serif fonts have correction factors.
- Contrast is checked only against the solid page background, not over photos or shapes.
- `collage` is studied and stored, but one slide currently carries one image slot, so it composes as contained imagery.
- Live vision quality, image composition and manual editor save/reopen/export need live credentials and a browser to verify.
