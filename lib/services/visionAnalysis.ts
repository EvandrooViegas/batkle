/**
 * Local image tagging using zero-shot image classification.
 * Model: Xenova/clip-vit-base-patch32 (~350MB)
 *
 * CLIP scores the image against a predefined list of candidate labels
 * and returns confidence scores for each. This gives accurate, meaningful
 * tags for real-world photos rather than narrow ImageNet categories.
 *
 * Model is cached in process after first load.
 */

export interface AssetAnalysis {
  tags: string[]
}

// ─── candidate labels ─────────────────────────────────────────────────────────
// These are the concepts we score every image against.
// Add or remove entries to tune what gets detected.

const CANDIDATE_LABELS = [
  // People & social
  'person', 'people', 'man', 'woman', 'child', 'team', 'group', 'crowd',
  'portrait', 'face', 'smile',
  // Work & business
  'office', 'meeting', 'desk', 'laptop', 'computer', 'work', 'business',
  'presentation', 'conference', 'coworking',
  // Sports & activity
  'sport', 'football', 'soccer', 'basketball', 'running', 'gym', 'fitness',
  'athlete', 'training', 'exercise', 'swimming', 'cycling', 'tennis',
  // Nature & outdoors
  'nature', 'outdoor', 'sky', 'forest', 'beach', 'mountain', 'park',
  'garden', 'street', 'city', 'urban', 'landscape',
  // Food & drink
  'food', 'meal', 'restaurant', 'coffee', 'drink', 'cooking', 'kitchen',
  // Products & objects
  'product', 'phone', 'car', 'book', 'bag', 'clothing', 'fashion',
  // Lifestyle & creative
  'travel', 'home', 'interior', 'art', 'music', 'photography', 'design',
  'celebration', 'party', 'event',
  // Visual style
  'professional photography', 'minimal', 'colorful', 'dark', 'bright',
]

// Minimum CLIP score to include a label as a tag
const MIN_SCORE = 0.15

// ─── singleton ────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _classifier: any = null
let _loadPromise: Promise<void> | null = null

async function loadModel(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { pipeline, env } = require('@huggingface/transformers')
  // Vercel's function files are read-only; only the temp folder can hold the downloaded model.
  env.cacheDir = process.env.VERCEL ? require('node:path').join(require('node:os').tmpdir(), 'huggingface') : './.cache/huggingface'

  console.log('[vision] Loading CLIP zero-shot classifier…')
  const t0 = Date.now()
  _classifier = await pipeline(
    'zero-shot-image-classification',
    'Xenova/clip-vit-base-patch32',
    { device: 'cpu' },
  )
  console.log(`[vision] Classifier ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

async function getClassifier() {
  if (!_classifier) {
    if (!_loadPromise) {
      _loadPromise = loadModel().finally(() => { _loadPromise = null })
    }
    await _loadPromise
  }
  return _classifier
}

// ─── main export ──────────────────────────────────────────────────────────────

export async function analyseImageBuffer(
  imageBuffer: Buffer,
  mimeType: string,
): Promise<AssetAnalysis> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { RawImage } = require('@huggingface/transformers')

  const classifier = await getClassifier()

  const blob  = new Blob([imageBuffer], { type: mimeType })
  const image = await RawImage.fromBlob(blob)

  const results: { label: string; score: number }[] = await classifier(
    image,
    CANDIDATE_LABELS,
  )

  // Keep labels that score above the threshold, sorted by confidence
  const tags = results
    .filter(r => r.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .map(r => r.label)

  // Always return at least 5 tags — lower threshold if needed
  if (tags.length < 5) {
    const extra = results
      .filter(r => r.score < MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5 - tags.length)
      .map(r => r.label)
    tags.push(...extra)
  }

  console.log('\n========== IMAGE ANALYSIS ==========')
  console.log(JSON.stringify({
    tags,
    all_scores: results
      .sort((a, b) => b.score - a.score)
      .map(r => ({ label: r.label, score: parseFloat(r.score.toFixed(4)) }))
  }, null, 2))
  console.log('=====================================\n')

  return { tags }
}