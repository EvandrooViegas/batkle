import { crawlBusinessWebsite, fetchHomepage } from './services/websiteResearch'
import { buildBusinessProfile } from './services/businessProfile'
import { budgetedModels, budgetedCompletion } from './services/ai/requestBudget'
import 'dotenv/config';
import axios from 'axios';
import { load } from 'cheerio';
import Groq from 'groq-sdk';
import { extractDesignSystem as readWebsiteDesign } from './services/designExtractor';

// ============================================================================
// LANGUAGE UTILITIES
// ============================================================================

function getLanguageCode(languageName) {
  const languageMap = {
    'English': 'en',
    'Portuguese': 'pt',
    'Spanish': 'es',
    'French': 'fr',
    'German': 'de',
    'Italian': 'it'
  };
  return languageMap[languageName] || 'en';
}

// ============================================================================
// GROQ CLIENT MANAGEMENT
// ============================================================================

let groqClient = null;
let defaultModel = null;

function getGroqClient() {
  if (!groqClient) {
    const apiKey = process.env.GROQ_API_KEY || process.env.GROQ_API_KEY_2;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY environment variable is not set');
    }
    groqClient = new Groq({ apiKey,maxRetries:0 });
  }
  return groqClient;
}

async function getDefaultModel() {
  if (defaultModel) {
    return defaultModel;
  }

  try {
    const groq = getGroqClient();
    const models = await budgetedModels(groq);
    
    // Prioritize known working models
    const workingModels = ['groq/compound-mini', 'mixtral-8x7b-32768', 'llama-3-70b-versatile'];
    let selectedModel = models.data.find(m => workingModels.includes(m.id));
    
    // Fall back to any available model
    if (!selectedModel) {
      selectedModel = models.data[0];
    }
    
    defaultModel = selectedModel.id;
    console.log(`Selected model: ${defaultModel}`);
    return defaultModel;
  } catch (error) {
    console.error('Error fetching models, using fallback:', error.message);
    // Use a known working fallback
    defaultModel = 'groq/compound-mini';
    return defaultModel;
  }
}

// ============================================================================
// PAGE FETCHING & URL HANDLING
// ============================================================================

function findAboutPageUrl($, baseUrl) {
  const baseHost = new URL(baseUrl).hostname;

  // Look for about page link
  const aboutLink = $('a').filter(function () {
    const href = $(this).attr('href');
    const text = $(this).text().toLowerCase().trim();
    
    if (href && (text === 'about' || text === 'about us' || text.includes('about'))) {
      try {
        const absoluteUrl = new URL(href, baseUrl).href;
        if (new URL(absoluteUrl).hostname === baseHost) {
          return true;
        }
      } catch (e) {
        // Skip invalid URLs
      }
    }
    return false;
  }).first();

  if (aboutLink.length > 0) {
    try {
      const href = aboutLink.attr('href');
      return new URL(href, baseUrl).href;
    } catch (e) {
      return null;
    }
  }

  return null;
}

// ============================================================================
// BUSINESS NAME EXTRACTION
// ============================================================================

function extractBusinessName($, url) {
  let candidateName = null;

  // PRIORITY 1: og:site_name (most reliable)
  let ogSiteName = $('meta[property="og:site_name"]').attr('content');
  if (ogSiteName && ogSiteName.trim()) {
    candidateName = ogSiteName.trim();
  }

  // PRIORITY 2: application-name
  if (!candidateName) {
    let appName = $('meta[name="application-name"]').attr('content');
    if (appName && appName.trim()) {
      candidateName = appName.trim();
    }
  }

  // PRIORITY 3: Title tag - parse smartly
  if (!candidateName) {
    const titleText = $('title').text().trim();
    if (titleText) {
      // Remove common suffixes like "- The React Framework", "| Platform", " by Company"
      let cleaned = titleText
        .replace(/\s*[-|–—]\s*.+$/i, '') // Remove everything after dash/pipe
        .replace(/\s+by\s+.+$/i, '') // Remove "by Company"
        .trim();
      
      if (cleaned.length > 2 && cleaned.length < 50) {
        candidateName = cleaned;
      }
    }
  }

  // PRIORITY 4: H1 tag
  if (!candidateName) {
    const h1Text = $('h1').first().text().trim();
    if (h1Text && h1Text.length > 2 && h1Text.length < 50 && !h1Text.toLowerCase().includes('welcome')) {
      candidateName = h1Text;
    }
  }

  // PRIORITY 5: Domain name fallback
  if (!candidateName) {
    const domain = new URL(url).hostname;
    candidateName = domain.replace('www.', '').split('.')[0];
    candidateName = candidateName.charAt(0).toUpperCase() + candidateName.slice(1);
  }

  return candidateName || 'Unknown';
}

// ============================================================================
// ABOUT INFORMATION EXTRACTION
// ============================================================================

function extractAboutInfo($) {
  // PRIORITY 1: Meta description (official, concise)
  let metaDescription = $('meta[name="description"]').attr('content');
  if (metaDescription && metaDescription.trim()) {
    metaDescription = metaDescription.trim();
    // Accept if it's a reasonable length and doesn't look like lorem ipsum
    if (metaDescription.length > 30 && metaDescription.length < 600 && !metaDescription.toLowerCase().includes('lorem')) {
      return metaDescription;
    }
  }

  // PRIORITY 2: og:description (also official)
  let ogDescription = $('meta[property="og:description"]').attr('content');
  if (ogDescription && ogDescription.trim()) {
    ogDescription = ogDescription.trim();
    if (ogDescription.length > 30 && ogDescription.length < 600 && !ogDescription.toLowerCase().includes('lorem')) {
      return ogDescription;
    }
  }

  // PRIORITY 3: First substantial paragraph on page body
  let foundParagraph = null;
  $('body p, main p, article p, section p').each(function() {
    if (foundParagraph) return false; // break if already found
    
    let text = $(this).text().trim();
    // Avoid navigation, testimonials, footers
    if (text && text.length > 60 && text.length < 500 && 
        !text.includes('©') && 
        !text.match(/^(our|the)\s+team/i) &&
        !text.match(/testimonial|quote/i) &&
        !text.includes('button') &&
        !text.toLowerCase().includes('lorem')) {
      foundParagraph = text;
      return false; // break
    }
  });

  if (foundParagraph) {
    return foundParagraph;
  }

  return 'No information found';
}

// ============================================================================
// LANGUAGE DETECTION
// ============================================================================

function detectLanguage(text, $) {
  // The word lists below only know six languages. A site that declares another one (lang="nl") is
  // taken at its word, so its posts are not written in whichever of the six scores highest.
  const declared = String(($ && $('html').attr('lang')) || '').split('-')[0].toLowerCase();
  if (/^[a-z]{2,3}$/.test(declared) && !['en', 'pt', 'es', 'fr', 'de', 'it'].includes(declared)) {
    try {
      const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(declared);
      if (name && name.toLowerCase() !== declared) return name;
    } catch {}
  }

  if (!text) return 'English';

  const textLower = text.toLowerCase();
  
  // Check for explicit language indicators first
  if (textLower.includes('português') || textLower.includes('portugal')) {
    return 'Portuguese';
  }
  if (textLower.includes('français') || textLower.includes('france')) {
    return 'French';
  }
  if (textLower.includes('español') || textLower.includes('españa')) {
    return 'Spanish';
  }
  if (textLower.includes('deutsch') || textLower.includes('deutschland')) {
    return 'German';
  }
  if (textLower.includes('italiano') || textLower.includes('italia')) {
    return 'Italian';
  }
  
  // Enhanced language-specific word matching with more comprehensive vocabulary
  const englishWords = (textLower.match(/\b(the|and|is|to|in|for|of|that|this|with|have|from|or|by|one|all|about|our|we|us|are|at|be|has|your|can|will|more|their|who|which|what|when|where|how|why|was|were|been|being|would|could|should|may|might)\b/g) || []).length;
  
  const portugueseWords = (textLower.match(/\b(e|a|de|que|o|para|do|em|um|os|é|por|na|uma|este|ou|com|não|ser|seu|seus|nossa|nosso|como|mais|sobre|pelo|pela|também|muito|pode|todos|entre|até|seu|sua|seus|suas|onde|quando|porque|mas|já|ainda|sempre|cada|todo|toda|bem|fazer|ter|está|estão|somos|foram)\b/g) || []).length;
  
  const spanishWords = (textLower.match(/\b(el|la|de|que|y|a|en|un|ser|se|no|haber|por|con|su|para|como|estar|tener|le|lo|todo|pero|más|hacer|o|poder|decir|este|ir|otro|ese|si|me|ya|ver|porque|dar|cuando|él|muy|sin|vez|mucho|saber|qué|sobre|mi|alguno|mismo|yo|también|hasta|año|dos|querer|entre)\b/g) || []).length;
  
  const frenchWords = (textLower.match(/\b(le|de|et|à|un|la|en|être|des|que|pour|ce|dans|du|qui|est|vous|nous|avec|ne|sur|se|pas|plus|pouvoir|par|je|son|il|avoir|ou|quel|leur|faire|tout|comme|dire|elle|si|bien|peut|même|tous|votre|après|sans|faire|aussi|très|dont)\b/g) || []).length;
  
  const germanWords = (textLower.match(/\b(der|die|und|in|den|von|zu|das|mit|sich|des|auf|für|ist|im|dem|nicht|ein|eine|als|auch|es|an|werden|aus|er|hat|dass|sie|nach|wird|bei|einer|um|am|sind|noch|wie|einem|über|einen|so|zum|war|haben|nur|oder|aber|vor|zur|bis|mehr)\b/g) || []).length;
  
  const italianWords = (textLower.match(/\b(il|di|e|la|a|per|che|in|un|da|essere|con|non|si|come|questo|uno|avere|io|ma|più|loro|fare|tutto|anche|suo|così|molto|cosa|dove|quando|perché|ancora|quale|solo|dopo|tra|deve|già|poi|sempre|tutti|molto|fare|stesso|senza)\b/g) || []).length;
  
  // Character-based detection for better accuracy
  const portugueseAccents = (text.match(/[áéíóúâêôãõç]/gi) || []).length;
  const frenchAccents = (text.match(/[àâäéèêëïîôöùûüœæ]/gi) || []).length;
  const germanAccents = (text.match(/[äöüß]/gi) || []).length;
  const spanishAccents = (text.match(/[áéíóúñü¿¡]/gi) || []).length;
  
  // Create weighted scores combining word count and character patterns
  const scores = {
    Portuguese: portugueseWords * 2 + (portugueseAccents > 5 ? portugueseAccents : 0),
    Spanish: spanishWords * 2 + (spanishAccents > 5 ? spanishAccents : 0),
    French: frenchWords * 2 + (frenchAccents > 5 ? frenchAccents : 0),
    German: germanWords * 2 + (germanAccents > 3 ? germanAccents * 2 : 0),
    Italian: italianWords * 2,
    English: englishWords * 2
  };
  
  // Find the language with the highest score
  let maxScore = 0;
  let detectedLanguage = 'English';
  
  for (const [lang, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      detectedLanguage = lang;
    }
  }
  
  // Minimum threshold check - if no language has significant presence, check HTML lang as fallback
  if (maxScore < 10 && $) {
    let htmlLang = $('html').attr('lang');
    if (htmlLang) {
      const langCode = htmlLang.split('-')[0].toLowerCase();
      const langMap = {
        'en': 'English',
        'pt': 'Portuguese',
        'es': 'Spanish',
        'fr': 'French',
        'de': 'German',
        'it': 'Italian'
      };
      if (langMap[langCode]) {
        return langMap[langCode];
      }
    }
  }
  
  console.log(`      Language scores: EN=${scores.English}, PT=${scores.Portuguese}, ES=${scores.Spanish}, FR=${scores.French}, DE=${scores.German}, IT=${scores.Italian}`);
  console.log(`      Detected: ${detectedLanguage} (score: ${maxScore})`);
  
  return detectedLanguage;
}

function extractLogo($) {
  // Prefer the visible brand mark over small browser icons and social banners.
  const brandLogo = $('header img[alt*="logo" i], nav img[alt*="logo" i], header img[src*="logo" i], nav img[src*="logo" i]').first();
  const brandLogoUrl = brandLogo.attr('src') || brandLogo.attr('data-src');
  if (brandLogoUrl) return brandLogoUrl;
  // Try multiple logo sources in priority order
  
  // 1. Apple touch icon
  let logo = $('link[rel="apple-touch-icon"]').attr('href');
  if (logo) return logo;
  
  // 2. Favicon
  logo = $('link[rel="icon"]').attr('href');
  if (logo) return logo;
  
  // 3. Shortcut icon
  logo = $('link[rel="shortcut icon"]').attr('href');
  if (logo) return logo;
  
  // 4. OG image (alternative logo)
  logo = $('meta[property="og:image"]').attr('content');
  if (logo) return logo;
  
  // 5. Twitter image
  logo = $('meta[name="twitter:image"]').attr('content');
  if (logo) return logo;
  
  // 6. Look for logo in header images
  logo = $('header img[alt*="logo" i], nav img[alt*="logo" i]').attr('src');
  if (logo) return logo;
  
  // 7. First image with "logo" in src
  logo = $('img[src*="logo" i]').first().attr('src');
  if (logo) return logo;
  
  return null;
}

// ============================================================================
// ABOUT REFORMATTER - AI-powered "Brand is..." introduction
// ============================================================================

async function reformatAboutAsIntroduction(businessName, rawAboutInfo, services = [], language = 'English') {
  try {
    const groq = getGroqClient();
    const model = await getDefaultModel();
    
    const languageCode = getLanguageCode(language);
    
    const servicesText = services && services.length > 0 
      ? services.slice(0, 4).join(', ') 
      : '';
    
    // Language-specific prompts
    const prompts = {
      pt: `Crie uma introdução profissional de uma marca no formato TERCEIRA PESSOA, como se estivesse apresentando a empresa para alguém. Use o padrão: "${businessName} oferece..." ou "${businessName} proporciona..." ou similar.

Informações:
- Nome: ${businessName}
- Sobre: ${rawAboutInfo.substring(0, 300)}
${servicesText ? `- Serviços: ${servicesText}` : ''}

IMPORTANTE: 
1. Escreva APENAS em PORTUGUÊS
2. Use TERCEIRA PESSOA ("${businessName} oferece", "A empresa proporciona" - NÃO use "Nós")
3. Máximo 200 palavras
4. Seja profissional e atrativo
5. Destaque o diferencial e valor que entregam
6. Mencione resultados/impacto quando possível

Escreva apenas a introdução em português, sem explicações adicionais.`,

      es: `Crea una introducción profesional de una marca en formato TERCERA PERSONA, como si estuvieras presentando la empresa a alguien. Usa el patrón: "${businessName} ofrece..." o "${businessName} proporciona..." o similar.

Información:
- Nombre: ${businessName}
- Acerca de: ${rawAboutInfo.substring(0, 300)}
${servicesText ? `- Servicios: ${servicesText}` : ''}

IMPORTANTE:
1. Escribe SOLO en ESPAÑOL
2. Usa TERCERA PERSONA ("${businessName} ofrece", "La empresa proporciona" - NO uses "Nosotros")
3. Máximo 200 palabras
4. Sé profesional y atractivo
5. Destaca el diferencial y valor que entregan
6. Menciona resultados/impacto cuando sea posible

Escribe solo la introducción en español, sin explicaciones adicionales.`,

      fr: `Créez une introduction professionnelle d'une marque au format TROISIÈME PERSONNE, comme si vous présentiez l'entreprise à quelqu'un. Utilisez le modèle: "${businessName} offre..." ou "${businessName} fournit..." ou similaire.

Informations:
- Nom: ${businessName}
- À propos: ${rawAboutInfo.substring(0, 300)}
${servicesText ? `- Services: ${servicesText}` : ''}

IMPORTANT:
1. Écrivez UNIQUEMENT en FRANÇAIS
2. Utilisez la TROISIÈME PERSONNE ("${businessName} offre", "L'entreprise fournit" - N'utilisez PAS "Nous")
3. Maximum 200 mots
4. Soyez professionnel et engageant
5. Mettez en avant la différenciation et la valeur apportée
6. Mentionnez les résultats/impact quand possible

Écrivez uniquement l'introduction en français, sans explications supplémentaires.`,

      de: `Erstellen Sie eine professionelle Markeneinführung im FORMAT DRITTE PERSON, als würden Sie das Unternehmen jemandem vorstellen. Verwenden Sie das Muster: "${businessName} bietet..." oder "${businessName} liefert..." oder ähnlich.

Informationen:
- Name: ${businessName}
- Über: ${rawAboutInfo.substring(0, 300)}
${servicesText ? `- Dienstleistungen: ${servicesText}` : ''}

WICHTIG:
1. Schreiben Sie NUR auf DEUTSCH
2. Verwenden Sie die DRITTE PERSON ("${businessName} bietet", "Das Unternehmen liefert" - verwenden Sie NICHT "Wir")
3. Maximum 200 Wörter
4. Seien Sie professionell und ansprechend
5. Heben Sie das Unterscheidungsmerkmal und den gelieferten Wert hervor
6. Erwähnen Sie Ergebnisse/Auswirkungen wenn möglich

Schreiben Sie nur die Einführung auf Deutsch, ohne zusätzliche Erklärungen.`,

      it: `Crea un'introduzione professionale di un marchio in formato TERZA PERSONA, come se stessi presentando l'azienda a qualcuno. Usa il modello: "${businessName} offre..." o "${businessName} fornisce..." o simile.

Informazioni:
- Nome: ${businessName}
- Informazioni: ${rawAboutInfo.substring(0, 300)}
${servicesText ? `- Servizi: ${servicesText}` : ''}

IMPORTANTE:
1. Scrivi SOLO in ITALIANO
2. Usa la TERZA PERSONA ("${businessName} offre", "L'azienda fornisce" - NON usare "Noi")
3. Massimo 200 parole
4. Sii professionale e coinvolgente
5. Evidenzia il differenziatore e il valore fornito
6. Menziona risultati/impatto quando possibile

Scrivi solo l'introduzione in italiano, senza spiegazioni aggiuntive.`,

      en: `Create a professional brand introduction in THIRD PERSON format, as if introducing the company to someone. Use the pattern: "${businessName} delivers..." or "${businessName} provides..." or similar.

Information:
- Name: ${businessName}
- About: ${rawAboutInfo.substring(0, 300)}
${servicesText ? `- Services: ${servicesText}` : ''}

IMPORTANT:
1. Write ONLY in ENGLISH
2. Use THIRD PERSON ("${businessName} delivers", "They provide" - DO NOT use "We")
3. Maximum 200 words
4. Be professional and engaging
5. Highlight the differentiator and value delivered
6. Mention results/impact when possible

Write only the introduction in English, without additional explanations.`
    };
    
    // Use the prompt for the detected language, default to English
    const prompt = prompts[languageCode] || prompts['en'];

    const response = await budgetedCompletion(groq,{
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      model: model,
      max_tokens: 400,
      temperature: 0.7,
    });

    const reformatted = response.choices[0]?.message?.content?.trim();
    
    if (reformatted && reformatted.length > 20) {
      return reformatted;
    }
    
    // Fallback: format it manually if AI fails
    const fallbacks = {
      pt: `${businessName} oferece soluções inovadoras em ${servicesText || 'seu setor'}. ${rawAboutInfo.substring(0, 150)}...`,
      es: `${businessName} ofrece soluciones innovadoras en ${servicesText || 'su industria'}. ${rawAboutInfo.substring(0, 150)}...`,
      fr: `${businessName} offre des solutions innovantes dans ${servicesText || 'son secteur'}. ${rawAboutInfo.substring(0, 150)}...`,
      de: `${businessName} bietet innovative Lösungen in ${servicesText || 'ihrer Branche'}. ${rawAboutInfo.substring(0, 150)}...`,
      it: `${businessName} offre soluzioni innovative in ${servicesText || 'il suo settore'}. ${rawAboutInfo.substring(0, 150)}...`,
      en: `${businessName} delivers innovative solutions in ${servicesText || 'their industry'}. ${rawAboutInfo.substring(0, 150)}...`
    };
    
    return fallbacks[languageCode] || fallbacks['en'];
  } catch (error) {
    console.error(`Error reformatting about info:`, error.message);
    // Fallback formatting
    return `${businessName} delivers comprehensive solutions. ${rawAboutInfo}`;
  }
}

// ============================================================================
// SERVICES EXTRACTION
// ============================================================================

function extractServices($) {
  const services = new Set();

  // PATTERN 1: Look for section that describes features/capabilities
  $('h2, h3').each(function() {
    const text = $(this).text().trim();
    const section = $(this).closest('section');
    const sectionText = section.text().toLowerCase();
    
    // Only include if in a features/capabilities section
    if (sectionText.includes('feature') || sectionText.includes('capabilit') || 
        sectionText.includes('service') || sectionText.includes('product') ||
        sectionText.includes('what\'s')) {
      if (text && text.length > 5 && text.length < 80 &&
          !text.match(/testimonial|quote|customer|framework|get started|what|home|build/i)) {
        services.add(text);
      }
    }
  });

  // PATTERN 2: Feature cards with headings
  $('[class*="feature"], [class*="card"], [class*="item"]').each(function() {
    const $elem = $(this);
    // Skip if it's clearly a testimonial
    if ($elem.text().includes('quote') || $elem.text().includes('"')) return;
    
    const heading = $elem.find('h3, h4, h5, strong, b, .title, .name').first().text().trim();
    if (heading && heading.length > 5 && heading.length < 80 && !heading.match(/testimonial|quote/i)) {
      services.add(heading);
    }
  });

  // PATTERN 3: List items under feature sections
  $('h2, h3').each(function() {
    const headingText = $(this).text().toLowerCase();
    if (headingText.includes('feature') || headingText.includes('capabilit')) {
      let $list = $(this).nextAll('ul, ol').first();
      if ($list.length === 0) {
        $list = $(this).parent().find('ul, ol').first();
      }
      
      $list.find('li').slice(0, 8).each(function() {
        const text = $(this).text().trim().split('\n')[0];
        if (text && text.length > 5 && text.length < 80 && !text.match(/^(our|and|the)/i)) {
          services.add(text);
        }
      });
    }
  });

  // Clean results - be strict about what we include
  let result = Array.from(services)
    .map(s => s.trim())
    .filter(s => {
      if (!s || s.length < 5 || s.length > 100) return false;
      if (s.match(/^[\s\d\-()]+$/)) return false;
      if (s.toLowerCase().includes('lorem') || s.toLowerCase().includes('ipsum')) return false;
      if (s.includes('"') || s.includes('©') || s.includes('button')) return false;
      // Remove phrases that are clearly not service names
      if (s.match(/^(built on|built with|everything you|what\'s|how to|learn)/i)) return false;
      return true;
    })
    .slice(0, 10);

  return result;
}

async function generateServicesWithAI(businessName, aboutInfo, html) {
  try {
    const groq = getGroqClient();
    const model = await getDefaultModel();
    
    // Extract a reasonable text sample from HTML
    const $ = load(html);
    const mainText = $('body').text().substring(0, 1500);
    
    const prompt = `Based on this website content, extract 4-6 KEY services, features, or products offered by "${businessName}".

Website content: ${mainText}

About: ${aboutInfo}

Respond ONLY with a valid JSON array of simple service/product names. Example:
["Service 1", "Service 2", "Service 3"]`;

    const message = await budgetedCompletion(groq,{
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      model: model,
      max_tokens: 250,
    });

    let responseText = message.choices[0].message.content.trim();
    
    // Try to extract JSON
    try {
      // Remove markdown if present
      responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      
      // Find JSON array
      const startIdx = responseText.indexOf('[');
      const lastIdx = responseText.lastIndexOf(']');
      if (startIdx >= 0 && lastIdx > startIdx) {
        responseText = responseText.substring(startIdx, lastIdx + 1);
        const parsed = JSON.parse(responseText);
        
        if (Array.isArray(parsed)) {
          const result = parsed
            .filter(s => s && typeof s === 'string' && s.length > 2 && s.length < 100)
            .slice(0, 8);
          
          if (result.length > 0) {
            return result;
          }
        }
      }
    } catch (parseError) {
      // Silently fail and return empty
    }
  } catch (error) {
    console.error('Error generating services:', error.message);
  }
  
  return [];
}

// ============================================================================
// TARGET AUDIENCE EXTRACTION
// ============================================================================

function extractTargetAudience($) {
  let audienceText = null;

  // Look for specific audience patterns
  $('p, h2, h3, span, div').each(function () {
    const text = $(this).text().trim();
    
    if (!text || text.length < 30 || text.length > 500) return;
    
    // Patterns that indicate target audience
    const audiencePatterns = [
      /(?:perfect for|ideal for|designed for|built for|for\s+(?:small|medium|large|enterprise|startup|solo|independent|growing|new|aspiring)?\s*(?:businesses?|companies?|teams?|professionals?|developers?|entrepreneurs?))/i,
      /(?:help|allow|enable)s?\s+(?:small|medium|large|enterprise|startup|solo|independent|growing|new|aspiring)?\s*(?:businesses?|companies?|teams?|professionals?|developers?|entrepreneurs?)/i,
      /(?:target audience|target market|ideal customer)[\s:].{20,}/i
    ];

    for (const pattern of audiencePatterns) {
      if (pattern.test(text)) {
        // Make sure it's not a testimonial or quote
        if (!text.includes('"') && text.length > 40 && text.length < 400) {
          audienceText = text;
          return false; // break
        }
      }
    }
  });

  return audienceText;
}

async function generateTargetAudienceWithAI(businessName, aboutInfo, services, language = 'en') {
  try {
    const groq = getGroqClient();
    const model = await getDefaultModel();
    
    const servicesText = services && services.length > 0 
      ? services.slice(0, 5).join(', ') 
      : '';
    
    const prompts = {
      pt: `Com base nas informações desta empresa, escreva uma descrição CURTA (2-3 frases no máximo) do público-alvo/clientes. Seja específico e concreto, não genérico.

Nome da Empresa: ${businessName}
Sobre: ${aboutInfo.substring(0, 200)}
${servicesText ? `Principais Serviços: ${servicesText}` : ''}

IMPORTANTE: Escreva APENAS em PORTUGUÊS. Escreva SOMENTE a descrição do público, mais nada:`,

      es: `Según la información de esta empresa, escribe una descripción CORTA (máximo 2-3 frases) del público objetivo/clientes. Sé específico y concreto, no genérico.

Nombre de la Empresa: ${businessName}
Acerca de: ${aboutInfo.substring(0, 200)}
${servicesText ? `Servicios Principales: ${servicesText}` : ''}

IMPORTANTE: Escribe SOLO en ESPAÑOL. Escribe ÚNICAMENTE la descripción del público, nada más:`,

      fr: `Sur la base des informations de cette entreprise, rédigez une description COURTE (2-3 phrases maximum) du public cible/clients. Soyez précis et concret, pas générique.

Nom de l'Entreprise: ${businessName}
À propos: ${aboutInfo.substring(0, 200)}
${servicesText ? `Services Principaux: ${servicesText}` : ''}

IMPORTANT: Écrivez UNIQUEMENT en FRANÇAIS. Écrivez SEULEMENT la description du public, rien d'autre:`,

      de: `Schreiben Sie basierend auf diesen Unternehmensinformationen eine KURZE Beschreibung (maximal 2-3 Sätze) der Zielgruppe/Kunden. Seien Sie spezifisch und konkret, nicht allgemein.

Firmenname: ${businessName}
Über: ${aboutInfo.substring(0, 200)}
${servicesText ? `Hauptdienstleistungen: ${servicesText}` : ''}

WICHTIG: Schreiben Sie NUR auf DEUTSCH. Schreiben Sie NUR die Zielgruppenbeschreibung, nichts anderes:`,

      it: `In base alle informazioni di questa azienda, scrivi una descrizione BREVE (massimo 2-3 frasi) del pubblico di riferimento/clienti. Sii specifico e concreto, non generico.

Nome dell'Azienda: ${businessName}
Informazioni: ${aboutInfo.substring(0, 200)}
${servicesText ? `Servizi Principali: ${servicesText}` : ''}

IMPORTANTE: Scrivi SOLO in ITALIANO. Scrivi SOLAMENTE la descrizione del pubblico, nient'altro:`,

      en: `Based on this business information, write a SHORT (2-3 sentences max) description of the target audience/customers. Be specific and concrete, not generic.

Business Name: ${businessName}
About: ${aboutInfo.substring(0, 200)}
${servicesText ? `Top Services: ${servicesText}` : ''}

IMPORTANT: Write ONLY in ENGLISH. Write ONLY the audience description, nothing else:`
    };

    const prompt = prompts[language] || prompts['en'];

    const message = await budgetedCompletion(groq,{
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      model: model,
      max_tokens: 150,
    });

    let result = message.choices[0].message.content.trim();
    return result;
  } catch (error) {
    console.error('Error generating target audience:', error.message);
    return '';
  }
}

// ============================================================================
// DESIGN SYSTEM EXTRACTION
// ============================================================================

// Reads the homepage HTML, its stylesheets and its logo; no browser, so it also runs on Vercel.
async function extractDesignSystem(html, url) {
  try {
    const design = await readWebsiteDesign(html, url);
    console.log(`      Read ${design.evidence.stylesheets} stylesheets${design.evidence.logo ? ' and the logo' : ''}`);
    console.log(`      Colors: ${design.colors.join(', ') || 'none found'} | Fonts: ${design.fonts.join(', ') || 'none found'}`);
    return { colors: design.colors, fonts: design.fonts };
  } catch (error) {
    console.error('      ⚠ Design extraction failed:', error.message);
    return { colors: [], fonts: [] };
  }
}

async function enhanceDesignSystemWithAI(businessName, designSystem) {
  // Just return what was extracted - no AI enhancement
  return {
    colors: designSystem.colors || [],
    fonts: designSystem.fonts || [],
  };
}

async function generateBusinessDescription(businessName, aboutInfo, services, targetAudience, language = 'en') {
  try {
    const groq = getGroqClient();
    const model = await getDefaultModel();
    
    // Build clean input strings
    const servicesStr = (services && services.length > 0)
      ? services.slice(0, 4).map(s => s.substring(0, 60)).join(' • ')
      : '';
    
    const aboutStr = (aboutInfo && aboutInfo.length > 0)
      ? aboutInfo.substring(0, 250)
      : businessName;

    // Language-specific prompts
    const prompts = {
      pt: `Crie uma descrição concisa e envolvente com aproximadamente 120 palavras sobre ${businessName}.

Informações disponíveis:
- Sobre: ${aboutStr}
${servicesStr ? `- Principais serviços: ${servicesStr}` : ''}

IMPORTANTE: Escreva APENAS em PORTUGUÊS. A descrição deve ser clara, profissional e destacar os principais benefícios e diferenciais. Não inclua formatação adicional, nomes de campos ou explicações.`,

      es: `Crea una descripción concisa y atractiva con aproximadamente 120 palabras sobre ${businessName}.

Información disponible:
- Acerca de: ${aboutStr}
${servicesStr ? `- Servicios principales: ${servicesStr}` : ''}

IMPORTANTE: Escribe SOLO en ESPAÑOL. La descripción debe ser clara, profesional y destacar los principales beneficios y diferenciadores. No incluyas formato adicional, nombres de campos o explicaciones.`,

      fr: `Créez une description concise et engageante d'environ 120 mots sur ${businessName}.

Informations disponibles:
- À propos: ${aboutStr}
${servicesStr ? `- Services principaux: ${servicesStr}` : ''}

IMPORTANT: Écrivez UNIQUEMENT en FRANÇAIS. La description doit être claire, professionnelle et mettre en avant les principaux avantages et différenciateurs. N'incluez pas de formatage supplémentaire, de noms de champs ou d'explications.`,

      de: `Erstellen Sie eine prägnante und ansprechende Beschreibung mit etwa 120 Wörtern über ${businessName}.

Verfügbare Informationen:
- Über: ${aboutStr}
${servicesStr ? `- Hauptdienstleistungen: ${servicesStr}` : ''}

WICHTIG: Schreiben Sie NUR auf DEUTSCH. Die Beschreibung sollte klar und professionell sein und die wichtigsten Vorteile und Unterscheidungsmerkmale hervorheben. Fügen Sie keine zusätzliche Formatierung, Feldnamen oder Erklärungen hinzu.`,

      it: `Crea una descrizione concisa e coinvolgente di circa 120 parole su ${businessName}.

Informazioni disponibili:
- Informazioni: ${aboutStr}
${servicesStr ? `- Servizi principali: ${servicesStr}` : ''}

IMPORTANTE: Scrivi SOLO in ITALIANO. La descrizione deve essere chiara, professionale e mettere in evidenza i principali vantaggi e differenziatori. Non includere formattazione aggiuntiva, nomi di campi o spiegazioni.`,

      en: `Create a concise and engaging description with approximately 120 words about ${businessName}.

Available information:
- About: ${aboutStr}
${servicesStr ? `- Main services: ${servicesStr}` : ''}

IMPORTANT: Write ONLY in ENGLISH. The description should be clear, professional, and highlight the main benefits and differentiators. Do not include additional formatting, field names, or explanations.`
    };

    const prompt = prompts[language] || prompts['en'];

    const response = await budgetedCompletion(groq,{
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      model: model,
      max_tokens: 600,
      temperature: 0.7,
    });

    const rawText = response.choices[0]?.message?.content;
    
    if (!rawText || typeof rawText !== 'string') {
      console.warn(`Empty response from model ${model} for ${businessName}`);
      return '';
    }
    
    let description = rawText.trim();
    
    // Accept anything longer than 50 chars
    if (description.length < 50) {
      console.warn(`Description too short (${description.length} chars) for ${businessName}`);
      return '';
    }
    
    // Light cleanup
    description = description
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Ensure proper ending
    if (description && !description.match(/[.!?]$/)) {
      description += '.';
    }
    
    console.log(`✓ Generated description for ${businessName} (${description.length} chars) in ${language}`);
    return description;
  } catch (error) {
    console.error(`Error generating description for ${businessName}:`, error.message);
    return '';
  }
}

// ============================================================================
// MAIN EXTRACTION ORCHESTRATOR
// ============================================================================

async function extractBusinessInfo(url) {
  try {
    // Validate and normalize URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }

    console.log(`\n========== BUSINESS INFORMATION EXTRACTION ==========\n`);

    // Step 1: Fetch main page
    console.log(`[1/7] Fetching main page: ${url}`);
    const page = await fetchHomepage(url).catch(error => {
      console.error(`Failed to fetch ${url}:`, error.message);
      // A domain provider's placeholder and a site that can't be opened carry their own explanation for people.
      throw /placeholder/.test(error.message) || error.unreachable ? error : new Error('Failed to fetch main page');
    });
    // Research the address that answered ("www.acme.pt" when "acme.pt" is a placeholder).
    url = page.url;
    const html = page.html;
    // Colors and fonts only need the homepage; read them while the rest of the site is researched.
    const designRead = extractDesignSystem(html, page.url);

    let $ = load(html);
    let pageCount = 1;

    // Step 1.5: Extract logo
    console.log(`[1.5/7] Extracting logo...`);
    let logo = extractLogo($);
    if (logo) {
      // Convert relative URLs to absolute
      if (!logo.startsWith('http://') && !logo.startsWith('https://')) {
        const baseUrl = new URL(url);
        logo = new URL(logo, baseUrl).href;
      }
      console.log(`      ✓ Logo found: ${logo.substring(0, 80)}...`);
    } else {
      console.log(`      ✗ Logo not found`);
    }

    // Step 2: Extract business name
    console.log(`[2/7] Extracting business name...`);
    const businessName = extractBusinessName($, url);
    console.log(`      ✓ Business Name: ${businessName}`);

    // Step 3: Extract about info (raw)
    console.log(`[3/7] Extracting about information...`);
    let rawAboutInfo = extractAboutInfo($);
    console.log(`      ✓ Raw About Info: ${rawAboutInfo.substring(0, 100)}...`);

    // Step 3.5: Detect language
    console.log(`[3.5/7] Detecting language...`);
    const language = detectLanguage(rawAboutInfo + ' ' + $('body').text(), $);
    console.log(`      ✓ Language detected: ${language}`);

    // Research business content across up to five pages before one synthesis call.
    const research = await crawlBusinessWebsite(url, html);
    pageCount = research.pages.length;
    const profile = await buildBusinessProfile(research, businessName, language, getGroqClient());
    let services = profile.services;
    let targetAudience = profile.targetAudience;

    // Step 6: Extract design system
    console.log(`[6/7] Extracting design system...`);
    let designSystem = await designRead;
    console.log(`      ✓ Found ${designSystem.colors.length} colors, ${designSystem.fonts.length} fonts`);

    // Try to find and fetch about page
    console.log(`\n[Additional] Looking for about page...`);
    const aboutPageUrl = findAboutPageUrl($, url);
    
    if (aboutPageUrl) {
      console.log(`      ✓ Found: ${aboutPageUrl}`);
      const aboutHtml = research.pages.find(page => page.url.replace(/\/$/, '') === aboutPageUrl.replace(/\/$/, ''))?.html;
      
      if (aboutHtml) {
        // Reuse the page within the five-page crawl budget.
        const about$ = load(aboutHtml);

        // Try to find logo on about page too
        if (!logo) {
          const aboutLogo = extractLogo(about$);
          if (aboutLogo) {
            const baseUrl = new URL(url);
            logo = new URL(aboutLogo, baseUrl).href;
          }
        }
      }
    } else {
      console.log(`      ✗ No about page found`);
    }

    // Enhance design system if incomplete
    if (!designSystem.colors.length || !designSystem.fonts.length) {
      console.log(`[AI Enhancement] Enhancing design system...`);
      designSystem = await enhanceDesignSystemWithAI(businessName, designSystem);
      console.log(`      ✓ Enhanced`);
    }

    // Step 7: Generate brand introduction in third person
    console.log(`[7/7] Generating brand introduction...`);
    const brandIntroduction = profile.about;
    
    if (brandIntroduction && brandIntroduction.length > 0) {
      console.log(`      ✓ Generated (${brandIntroduction.length} chars)`);
    } else {
      console.log(`      ⚠ Generation returned empty`);
    }

    console.log(`\n========== EXTRACTION COMPLETE ==========\n`);
    
    // Display the brand introduction prominently
    if (brandIntroduction && brandIntroduction.trim().length > 0) {
      console.log(`\n╔════════════════════════════════════════════════════════════════╗`);
      console.log(`║          BRAND INTRODUCTION                                   ║`);
      console.log(`╚════════════════════════════════════════════════════════════════╝\n`);
      console.log(brandIntroduction);
      console.log(`\n`);
    }

    // Clean up about text from Google Translate warnings
    let cleanAbout = brandIntroduction || rawAboutInfo;
    cleanAbout = cleanAbout
      .replace(/ATENÇÃO:.*?tradução automática\./gi, '')
      .replace(/WARNING:.*?automatic translation\./gi, '')
      .replace(/AVISO:.*?traducción automática\./gi, '')
      .replace(/NOTE:.*?automatic translation\./gi, '')
      .replace(/Isto pode.*?não nos\s*responsabilizamos.*?automática\./gi, '')
      .replace(/This may.*?this automatic translation\./gi, '')
      .replace(/Esto puede.*?esta traducción automática\./gi, '')
      .replace(/This might.*?this automatic translation\./gi, '')
      .trim();

    const result = {
      ...profile,
      pagesAnalyzed: pageCount,
      name: businessName || 'Unknown',
      about: cleanAbout,
      logo: logo || null,
      language: language,
      services: services || [],
      targetAudience: targetAudience || null,
      designSystem: {
        colors: designSystem.colors || [],
        fonts: designSystem.fonts || [],
      },
    };

    console.log('\n========== BRAND INFORMATION ==========')
    console.log(JSON.stringify({
      name: result.name,
      about: result.about,
      logo: result.logo,
      language: result.language,
      designSystem: {
        colors: result.designSystem.colors,
        fonts: result.designSystem.fonts,
      },
    }, null, 2))
    console.log('========================================\n')

    return result;

  } catch (error) {
    console.error('\n✗ Error:', error.message);
    throw error;
  }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  const url = process.argv[2];

  if (!url) {
    console.error('\nUsage: node business-info-extractor-complete.js <url>\n');
    console.error('Example:');
    console.error('  node business-info-extractor-complete.js https://example.com\n');
    process.exit(1);
  }

  try {
    const result = await extractBusinessInfo(url);
    console.log('\n=== EXTRACTED DATA ===\n');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('\n✗ Extraction Failed:', error.message);
    process.exit(1);
  }
}

// Export for module use
export { extractBusinessInfo };

// Run if executed directly
if (require.main === module) {
  main();
}
