import { INITIAL_GLOBAL_FAMILIES } from './seeds'
import { familySchema } from './types'
import { reconcileStudy } from './study'
import { canKeepUsing, canSee, canUse, libraryInfo, upgradeToUseError, visibilityOf, VISIBILITIES, type Viewer, type Visibility } from './access'
import type { GlobalDesignFamily, GlobalDesignRecord, BrandGlobalDesign } from './types'

export class DesignLibraryError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}
const records = (db: any) => db.collection('globalDesignFamilies')
const versions = (db: any) => db.collection('globalDesignVersions')
const plain = ({ _id, ...rest }: any) => rest
const initialized = new WeakMap<object, Promise<void>>()
// Existing MongoDB collections are schemaless. Fixed _ids make this additive migration idempotent.
export async function ensureGlobalDesignLibrary(db: any) {
  if (initialized.has(db)) return initialized.get(db)
  const pending = seedLibrary(db).catch(error => { initialized.delete(db); throw error })
  initialized.set(db, pending)
  return pending
}
async function seedLibrary(db: any) {
  for (const seed of INITIAL_GLOBAL_FAMILIES) {
    const family = familySchema.parse(seed)
    await versions(db).updateOne({ _id: `${family.id}:${family.version}` }, { $setOnInsert: { ...family } }, { upsert: true })
    await records(db).updateOne({ _id: family.id }, { $setOnInsert: { id: family.id, status: 'published', revision: family.version + 1, publishedVersion: family.version, draft: family, updatedAt: new Date() } }, { upsert: true })
    const current = await records(db).findOne({ _id: family.id })
    // Upgrade only untouched bundled families. Admin edits and pinned brand versions win.
    if (!current.deletedAt && current.status === 'published' && current.publishedVersion < family.version && current.revision === current.publishedVersion + 1) {
      await records(db).updateOne({ _id: family.id, revision: current.revision, status: 'published' }, { $set: { draft: family, publishedVersion: family.version, revision: family.version + 1, updatedAt: new Date() } })
    }
  }
}
export async function getGlobalVersion(db: any, id: string, version: number): Promise<GlobalDesignFamily> {
  const family = await versions(db).findOne({ _id: `${id}:${version}` })
  if (!family) throw new DesignLibraryError('The selected design version is unavailable.', 404)
  return plain(family)
}
export async function listGlobalDesigns(db: any, admin = false) {
  await ensureGlobalDesignLibrary(db)
  const list = await records(db).find({ deletedAt: { $exists: false }, ...(admin ? {} : { status: 'published' }) }).toArray()
  return admin ? list.map(plain) : Promise.all(list.map((r: GlobalDesignRecord) => getGlobalVersion(db, r.id, r.publishedVersion!)))
}
/**
 * The library as one account sees it: every published design it may see, Batkle's own first and then members' newest
 * first, each with `library` (author, visibility, and whether the account can use it or needs to upgrade).
 */
export async function listLibrary(db: any, viewer: Viewer) {
  await ensureGlobalDesignLibrary(db)
  const list = (await records(db).find({ deletedAt: { $exists: false }, status: 'published' }).toArray()).filter((r: any) => canSee(r, viewer))
  const order = (r: any) => (r.ownerId ? 1 : 0)
  list.sort((a: any, b: any) => order(a) - order(b) || (order(a) ? +new Date(b.updatedAt) - +new Date(a.updatedAt) : 0))
  return Promise.all(list.map(async (r: any) => ({ ...(await getGlobalVersion(db, r.id, r.publishedVersion!)), library: libraryInfo(r, viewer) })))
}

/** The account's own designs, drafts included, newest first: its "Your designs" list. */
export async function listOwnRecords(db: any, viewer: Viewer) {
  if (!viewer.userId) return []
  const list = await records(db).find({ ownerId: viewer.userId, deletedAt: { $exists: false } }).toArray()
  list.sort((a: any, b: any) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
  return list.map((r: any) => ({ ...plain(r), library: libraryInfo(r, viewer) }))
}

/** Which of the families a brand uses this account may still generate with (canKeepUsing). */
export async function usableFamilyIds(db: any, viewer: Viewer, ids: string[]): Promise<Set<string>> {
  const unique = [...new Set(ids)]
  const found = await Promise.all(unique.map(id => records(db).findOne({ _id: id })))
  return new Set(unique.filter((_, i) => canKeepUsing(found[i], viewer)))
}

export async function getGlobalRecord(db: any, id: string): Promise<GlobalDesignRecord> {
  await ensureGlobalDesignLibrary(db)
  const record = await records(db).findOne({ _id: id, deletedAt: { $exists: false } })
  if (!record) throw new DesignLibraryError('Design family not found', 404)
  return plain(record)
}
/**
 * Saves a draft. A new design made by a member carries `owner` (their account and the name shown as its author) and
 * stays private until published; one made by the admin has no owner and is one of Batkle's own.
 */
export async function saveGlobalDraft(db: any, input: unknown, revision?: number, owner?: { id: string; name: string }) {
  // Admin edits can add or remove photo areas; image modes and the family imagery strategy follow the geometry.
  const family = familySchema.parse(reconcileStudy(familySchema.innerType().parse(input) as any))
  if (revision === undefined) {
    const ownership = owner ? { ownerId: owner.id, author: { name: String(owner.name || '').slice(0, 80) }, visibility: 'private', createdAt: new Date() } : {}
    try { await records(db).insertOne({ _id: family.id, id: family.id, draft: family, revision: 1, status: 'draft', ...ownership, updatedAt: new Date() }) }
    catch (error: any) { if (error.code === 11000) throw new DesignLibraryError('This family already exists. Reload before saving.', 409); throw error }
  } else {
    const result = await records(db).updateOne({ _id: family.id, revision, deletedAt: { $exists: false } }, { $set: { draft: family, updatedAt: new Date() }, $inc: { revision: 1 } })
    if (!result.matchedCount) throw new DesignLibraryError('This family changed in another window. Reload before saving.', 409)
  }
  return getGlobalRecord(db, family.id)
}
/** Publishes the reviewed draft. A member's design is published `visibility` (public or private); Batkle's are public. */
export async function publishGlobalDesign(db: any, id: string, revision: number, visibility?: Visibility) {
  const record = await getGlobalRecord(db, id)
  if (record.revision !== revision) throw new DesignLibraryError('Reload this draft before publishing.', 409)
  const family = familySchema.parse({ ...record.draft, version: revision })
  // A draft revision is immutable. An interrupted publish can safely retry this insert.
  await versions(db).updateOne({ _id: `${id}:${revision}` }, { $setOnInsert: family }, { upsert: true })
  const shown = record.ownerId ? { visibility: VISIBILITIES.includes(visibility as Visibility) ? visibility : visibilityOf(record) } : {}
  const result = await records(db).updateOne({ _id: id, revision, deletedAt: { $exists: false } }, { $set: { status: 'published', publishedVersion: revision, ...shown, updatedAt: new Date() }, $inc: { revision: 1 } })
  if (!result.matchedCount) throw new DesignLibraryError('The draft changed while publishing. Reload and review it again.', 409)
  return getGlobalRecord(db, id)
}
export async function retireGlobalDesign(db: any, id: string, revision: number, deleted = false) {
  const result = await records(db).updateOne({ _id: id, revision, deletedAt: { $exists: false } }, { $set: { status: 'draft', ...(deleted ? { deletedAt: new Date() } : {}), updatedAt: new Date() }, $inc: { revision: 1 } })
  if (!result.matchedCount) throw new DesignLibraryError('The family changed. Reload before continuing.', 409)
  // Published versions remain available to brands and previously generated posts.
  return { success: true }
}
/**
 * Sets the designs a brand uses. With `viewer`, a design newly switched on must be one the account may use: a design
 * it cannot see reads as missing, and a member's design on a Free plan asks for the upgrade. Designs the brand
 * already uses keep their pinned version.
 */
export async function selectBrandFamilies(db: any, flowId: string, ids: string[], viewer?: Viewer) {
  const selected = [...new Set(ids)]
  if (selected.length > 24) throw new DesignLibraryError('Select up to 24 different Global Designs.')
  const flow = await db.collection('flows').findOne({ id: flowId })
  if (!flow) throw new DesignLibraryError('Brand not found', 404)
  const previous = (flow.brandContext?.designs || []).filter((d: any) => d.source === 'global')
  const designs: BrandGlobalDesign[] = await Promise.all(selected.map(async id => {
    const record = await getGlobalRecord(db, id).catch(error => {
      if (previous.some((d: any) => d.globalFamilyId === id)) return null
      throw error
    })
    const existing = previous.find((d: any) => d.globalFamilyId === id)
    if (existing) return existing // Keep its pinned version, including retired families.
    if (viewer && record && !canUse(record, viewer)) throw canSee(record, viewer) ? upgradeToUseError() : new DesignLibraryError('Design family not found', 404)
    if (!record || record.status !== 'published') throw new DesignLibraryError('Only published designs can be imported.')
    const family = await getGlobalVersion(db, id, record.publishedVersion!)
    return { id: `global-${id}`, source: 'global' as const, globalFamilyId: id, globalVersion: family.version, name: family.name, tags: family.tags, createdAt: new Date().toISOString() }
  }))
  const legacy = (flow.brandContext?.designs || []).filter((d: any) => d.source !== 'global')
  const result = await db.collection('flows').updateOne({ id: flowId, 'brandContext.designs': flow.brandContext?.designs === undefined ? { $exists: false } : flow.brandContext.designs }, { $set: { 'brandContext.designs': [...legacy, ...designs], 'brandContext.designLibraryVersion': 1, updatedAt: new Date() } })
  if (!result.matchedCount) throw new DesignLibraryError('Brand designs changed in another window. Reload and try again.', 409)
  return { brandContext: { ...flow.brandContext, designs: [...legacy, ...designs], designLibraryVersion: 1 } }
}
export async function hydrateBrandFamilies(db: any, brand: any) {
  const designs = (brand?.designs || []).filter((d: any) => d.source === 'global')
  return Promise.all(designs.map(async (d: BrandGlobalDesign) => ({ design: d, family: await getGlobalVersion(db, d.globalFamilyId, d.globalVersion) })))
}
