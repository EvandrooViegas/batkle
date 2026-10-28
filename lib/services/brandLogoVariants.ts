import { generateLogoVariants } from './logoVariants'
import { persistInlineImages } from './persistInlineImages'
import { loadUpload } from './uploadCache'

export async function ensureBrandLogoVariants(db:any,brand:any){
 const source=brand?.logo
 if(!source)return null
 const existing=brand.logoVariants
 // Variants saved before the ink, bounds and per-ground measurements, or made the earlier way (`version`, which
 // createLogoVariants sets to LOGO_VARIANTS_VERSION: 2), are regenerated once, so layouts keep the logo legible and aligned.
 if(existing?.source===source&&existing.blackTransparent&&existing.whiteTransparent&&'inkLightness' in existing&&'bounds' in existing&&'lostOnDark' in existing&&(existing.version||1)>=2)return existing
 let input=source
 const local=source.match(/^\/api\/uploads\/([^/?]+)$/)
 if(local){
  const upload=await loadUpload(db,local[1])
  if(!upload)throw Error('Brand logo upload is missing')
  input=`data:${upload.contentType};base64,${upload.bytes.toString('base64')}`
 }
 const generated=await generateLogoVariants(input)
 const variants=await persistInlineImages(db,{...generated,source})
 if(brand.id)await db.collection('flows').updateOne({id:brand.id,'brandContext.logo':source},{$set:{'brandContext.logoVariants':variants}})
 brand.logoVariants=variants
 return variants
}
