// Stand-ins for image storage helpers, for tests that load a module with its imports stripped.

/** loadUpload without the in-memory cache: each call reads the fake database. */
async function loadUpload(db, id) {
  const doc = await db.collection('uploads').findOne({ id }, { projection: { _id: 0, bytes: 1, contentType: 1 } })
  if (!doc?.bytes) return null
  const bytes = doc.bytes
  return {
    bytes: Buffer.isBuffer(bytes) ? bytes : typeof bytes.value === 'function' ? Buffer.from(bytes.value()) : Buffer.from(bytes.buffer ?? bytes),
    contentType: doc.contentType || 'image/png',
  }
}

/** compactImage that stores bytes unchanged, so tests keep asserting on their own fixtures. */
async function keepImage(bytes, contentType) {
  return { bytes, contentType }
}

module.exports = { loadUpload, keepImage }
