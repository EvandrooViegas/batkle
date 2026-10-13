import sharp from 'sharp'

// Smaller images are already efficient; re-encoding them saves little and costs CPU.
const MIN_BYTES = 150 * 1024
const PIXEL_LIMIT = 40_000_000
const read = (bytes: Buffer) => sharp(bytes, { limitInputPixels: PIXEL_LIMIT })

export interface StoredImage { bytes: Buffer; contentType: string }

/**
 * True when two RGBA buffers display identically: the same alpha everywhere and the same colour wherever a pixel
 * is visible. Fully transparent pixels can never be seen, and WebP does not keep their hidden colour.
 */
export function sameVisiblePixels(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] !== b[i + 3]) return false
    if (a[i + 3] !== 0 && (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2])) return false
  }
  return true
}

/**
 * Bytes to store for an image in MongoDB, whose free cluster holds 512 MB in total, without any quality loss.
 * 8-bit PNGs are re-encoded as lossless WebP, then decoded and compared pixel by pixel with the original;
 * any visible difference, or a saving under 5%, keeps the original. JPEG and WebP are kept as they are,
 * because re-encoding them would lose quality, and so are 16-bit PNGs (WebP is 8-bit).
 */
export async function compactImage(bytes: Buffer, contentType: string): Promise<StoredImage> {
  const original = { bytes, contentType }
  if (bytes.length < MIN_BYTES || !/^image\/png$/i.test(contentType || '')) return original
  try {
    const meta = await read(bytes).metadata()
    if (!meta.width || !meta.height || (meta.pages || 1) > 1 || (meta.depth && meta.depth !== 'uchar')) return original
    let image = read(bytes)
    if (meta.orientation && meta.orientation !== 1) image = image.withMetadata({ orientation: meta.orientation })
    // Effort 2 is about 2.5x faster than 5 for ~1% larger files on real cutouts; it is still lossless.
    const webp = await image.webp({ lossless: true, effort: 2 }).toBuffer()
    if (webp.length > bytes.length * 0.95) return original
    const [before, after] = await Promise.all([read(bytes).ensureAlpha().raw().toBuffer(), read(webp).ensureAlpha().raw().toBuffer()])
    return sameVisiblePixels(before, after) ? { bytes: webp, contentType: 'image/webp' } : original
  } catch {
    return original
  }
}
