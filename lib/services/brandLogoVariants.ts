import { generateLogoVariants } from './logoVariants'
import { persistInlineImages } from './persistInlineImages'
import { loadUpload } from './uploadCache'

export async function ensureBrandLogoVariants(db:any,brand:any){
 const source=brand?.logo
 if(!source)return null
 const existing=brand.logoVariants
 // Variants saved before the ink and bounds measurements are regenerated once, so layouts can keep the logo legible and aligned.
 if(existing?.source===source&&existing.blackTransparent&&existing.whiteTransparent&&'inkLightness' in existing&&'bounds' in existing)return existing
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
