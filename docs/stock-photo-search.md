# Background photo search

Background slots show a photo the user attached to the idea when the plan put one there; otherwise the resolver searches the configured stock providers concurrently and ranks their candidates together by slide keyword relevance, then original resolution. It reserves only the winning image across carousel slots. Photographs are never AI-generated; when no photo fits a global-design slot, it uses a transparent AI cutout instead (see `docs/design-study-generation.md`).

Configure server-side environment variables in `.env.local` (or the deployment environment):

```dotenv
PEXELS_API_KEY=your-pexels-api-key
UNSPLASH_ACCESS_KEY=your-unsplash-access-key
```

Get a Pexels API key at https://www.pexels.com/api/. Restart the server after changing its environment. Both providers are optional individually: a missing key or failed provider does not disable the other provider. Neither key is sent to the browser.

The existing Groq configuration refines each slide's photo queries. If query refinement is unavailable, local search briefs remain usable.

Known images smaller than 1080 pixels on their shortest side, watermarked metadata, unrelated descriptions, and previously selected stock IDs are excluded. Watermark filtering checks metadata, not image pixels; it cannot guarantee detection of unlabelled watermarks. Photographer credits and links appear in the image review panel, not over the exported slide.

Pexels IDs are stored with a `pexels:` prefix and Unsplash IDs with an `unsplash:` prefix in stock selection history. Legacy unprefixed Unsplash history remains supported. The planner's legacy `unsplash` preference means automatic stock search; the resolved source records the actual provider.

Validation:

```sh
node --test --test-isolation=none tests/assetResolver.test.cjs tests/assetDescription.test.cjs tests/photoSearchBrief.test.cjs tests/postLayout.test.cjs
```
