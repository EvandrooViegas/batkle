import { DEFAULT_SIZE, FILTER_RANGES, IMAGE_LIMITS, LIMITS, MASKS } from '@/lib/developer/document'
import { CREDIT_COSTS, RATE_LIMITS } from '@/lib/developer/pricing'

/**
 * The reference shown on /developers: the document POST /v1/posts takes (lib/developer/document.ts), every node
 * type and property, and example posts. The example images in public/developers/examples/ are these documents
 * rendered by the API itself; render them again when an example changes.
 */

const ROOM = 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=1200&q=80'
const HOUSE = 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200&q=80'
const PORTRAIT = 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=600&q=80'
const KITCHEN = 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=1200&q=80'

// Each property: [name, type, default, what it does].
export const DOCUMENT_FIELDS = [
  ['width', 'integer', String(DEFAULT_SIZE.width), `The post's width in pixels, ${LIMITS.minSize} to ${LIMITS.maxWidth}.`],
  ['height', 'integer', String(DEFAULT_SIZE.height), `The post's height in pixels, ${LIMITS.minSize} to ${LIMITS.maxHeight}. 1350 is Instagram's portrait post; 1080 a square one.`],
  ['background', 'colour or gradient', '"#FFFFFF"', 'What fills the post behind every node.'],
  ['nodes', 'node[]', '', `A single post: up to ${LIMITS.maxNodes} nodes, drawn in order.`],
  ['slides', 'slide[]', '', `A carousel: 2 to ${LIMITS.maxSlides} slides, each { "background", "nodes" }. Send "nodes" or "slides", not both.`],
  ['slide', 'integer', '', 'For a carousel: render only this slide (1 is the first) and get one PNG back.'],
]

export const COMMON_PROPS = [
  ['type', 'string', '', '"text", "image", "shape" or "gradient". Required.'],
  ['x', 'number', '0', 'Distance from the left edge of the post to the node, in pixels.'],
  ['y', 'number', '0', 'Distance from the top edge of the post to the node, in pixels.'],
  ['width', 'number', '', 'The node’s width in pixels. Required, except for text.'],
  ['height', 'number', '', 'The node’s height in pixels. Required, except for text.'],
  ['rotation', 'number', '0', 'Degrees, clockwise, around the node’s centre.'],
  ['opacity', 'number', '1', 'From 0 (invisible) to 1 (solid).'],
]

export const TEXT_PROPS = [
  ['text', 'string or span[]', '', 'Required. Use \\n for a new line. To style some words differently, send spans (below).'],
  ['width', 'number', 'post width − 2 × x', 'Lines wrap at this width, so text keeps the same margin on both sides unless you set it.'],
  ['height', 'number', 'to the bottom edge', 'Text that doesn’t fit in the box is cut off.'],
  ['fontFamily', 'string', '"Inter"', 'Any font from Google Fonts, by name, such as "Playfair Display" or "Poppins".'],
  ['fontSize', 'number', '48', 'In pixels, 6 to 600.'],
  ['fontWeight', 'integer', '400', '100 to 900; 700 is bold. The nearest weight the font has is used.'],
  ['fontStyle', '"normal" | "italic"', '"normal"', ''],
  ['color', 'colour', '"#000000"', ''],
  ['gradient', 'gradient', '', 'Fills the letters with a gradient instead of a colour.'],
  ['textAlign', '"left" | "center" | "right"', '"left"', 'Where each line sits across the box.'],
  ['verticalAlign', '"top" | "middle" | "bottom"', '"top"', 'Where the lines sit in the box’s height.'],
  ['lineHeight', 'number', '1.2', 'Line spacing, as a multiple of the font size.'],
  ['letterSpacing', 'number', '0', 'Extra space between letters, in pixels. Can be negative.'],
  ['textTransform', '"none" | "uppercase" | "lowercase" | "capitalize"', '"none"', ''],
  ['textDecoration', '"none" | "underline" | "line-through"', '"none"', ''],
  ['shadow', '{ x, y, blur, color }', '', 'A text shadow, in pixels: for example { "x": 0, "y": 4, "blur": 12, "color": "rgba(0,0,0,0.4)" }.'],
]

export const SPAN_PROPS = [
  ['text', 'string', '', 'Required. The words of this span.'],
  ['color', 'colour', 'the node’s', ''],
  ['background', 'colour', '', 'A highlight behind the words.'],
  ['padding', 'number', '0', 'Space between the words and the edges of the highlight, in pixels.'],
  ['fontFamily', 'string', 'the node’s', ''],
  ['fontSize', 'number', 'the node’s', ''],
  ['fontWeight', 'integer', 'the node’s', ''],
  ['fontStyle', '"normal" | "italic"', 'the node’s', ''],
  ['letterSpacing', 'number', 'the node’s', ''],
  ['textDecoration', '"none" | "underline" | "line-through"', 'the node’s', ''],
]

export const IMAGE_PROPS = [
  ['src', 'string', '', `Required. A public https URL of a PNG, JPEG, WebP, GIF or AVIF image (up to ${IMAGE_LIMITS.maxBytes / 1024 / 1024} MB), a data:image/…;base64 URL, or the /api/uploads/… address of an image in your Batkle account.`],
  ['fit', '"cover" | "contain" | "fill"', '"cover"', 'Cover fills the box and trims what overflows; contain shows the whole image inside the box; fill stretches it.'],
  ['borderRadius', 'number', '0', 'Rounds the corners, in pixels.'],
  ['mask', 'string', '"none"', `Cuts the image to a shape: ${MASKS.filter(m => m !== 'none').map(m => `"${m}"`).join(', ')}. A masked image always covers its box.`],
  ['crop', '{ top, right, bottom, left }', '', 'Trims a percentage off each edge of the picture. What is left keeps its place in the box.'],
  ['flipX', 'boolean', 'false', 'Mirrors the image left to right.'],
  ['flipY', 'boolean', 'false', 'Mirrors the image top to bottom.'],
  ['filters', 'object', '', 'Colour adjustments, each optional: ' + Object.entries(FILTER_RANGES).map(([name, [min, max]]) => `${name} (${min} to ${max})`).join(', ') + '. Brightness, contrast and saturate are percentages where 100 is unchanged; blur is in pixels and hueRotate in degrees.'],
]

export const SHAPE_PROPS = [
  ['shape', '"rectangle" | "ellipse"', '"rectangle"', 'An ellipse with the same width and height is a circle.'],
  ['fill', 'colour', '"#000000"', 'Use "transparent" for an outline only.'],
  ['borderRadius', 'number', '0', 'Rounds a rectangle’s corners, in pixels. Half the height makes a pill.'],
  ['stroke', '{ color, width }', '', 'An outline inside the edge, such as { "color": "#14131A", "width": 4 }.'],
]

export const GRADIENT_NODE_PROPS = [
  ['gradient', 'gradient', '', 'Required. The colours, below.'],
  ['shape', '"rectangle" | "ellipse"', '"rectangle"', ''],
  ['borderRadius', 'number', '0', 'Rounds a rectangle’s corners, in pixels.'],
]

export const GRADIENT_PROPS = [
  ['type', '"linear" | "radial"', '"linear"', ''],
  ['angle', 'number', '90', 'For a linear gradient, the direction in degrees: 90 runs left to right, 180 top to bottom.'],
  ['center', '{ x, y }', '{ "x": 50, "y": 50 }', 'For a radial gradient, where it starts, in percent of the box. A radial gradient reaches position 100 at the box’s farthest corner, so a round glow that fades out before the edge ends at about 70.'],
  ['stops', 'stop[]', '', `Required. 2 to ${LIMITS.maxStops} stops, each { "color": "#RRGGBB", "position": 0 to 100, "opacity": 0 to 1 }. Positions default to even spacing and opacity to 1.`],
]

export const COLOURS = 'Colours are hex ("#F2A900", "#F2A90080" with transparency), rgb() and rgba(), hsl() and hsla(), or a CSS name such as "white" or "transparent".'

// ─── Example posts (each one has a rendered image in public/developers/examples/) ──

export const EXAMPLES = {
  quickstart: {
    width: 1080, height: 1080, background: '#FFD84D',
    nodes: [
      { type: 'text', x: 90, y: 90, text: 'Hello from the Batkle API', fontFamily: 'Poppins', fontSize: 112, fontWeight: 800, lineHeight: 1.02, color: '#14131A' },
      { type: 'shape', x: 90, y: 860, width: 160, height: 12, fill: '#14131A' },
    ],
  },
  post: {
    width: 1080, height: 1350, background: '#14131A',
    nodes: [
      { type: 'image', src: KITCHEN, x: 0, y: 0, width: 1080, height: 860 },
      { type: 'gradient', x: 0, y: 460, width: 1080, height: 400, gradient: { angle: 180, stops: [{ color: '#14131A', opacity: 0 }, { color: '#14131A' }] } },
      { type: 'text', x: 80, y: 840, height: 240, text: ['Open house ', { text: 'this Saturday', color: '#FFD84D' }], fontFamily: 'Poppins', fontSize: 92, fontWeight: 700, lineHeight: 1.04, color: '#F6F3EA' },
      { type: 'text', x: 80, y: 1080, height: 110, text: 'See the new kitchen and bathroom, from 10:00 to 16:00.', fontSize: 38, lineHeight: 1.35, color: '#C4C1CE' },
      { type: 'shape', x: 80, y: 1216, width: 320, height: 68, fill: '#FFD84D', borderRadius: 34 },
      { type: 'text', x: 80, y: 1216, width: 320, height: 68, text: 'Book a visit', fontSize: 30, fontWeight: 700, color: '#14131A', textAlign: 'center', verticalAlign: 'middle' },
    ],
  },
  text: {
    width: 1080, height: 1080, background: '#F6F3EA',
    nodes: [
      { type: 'text', x: 90, y: 110, height: 50, text: 'Tip of the week', textTransform: 'uppercase', fontSize: 30, fontWeight: 700, letterSpacing: 6, color: '#5B5766' },
      { type: 'text', x: 90, y: 180, height: 460, text: ['Water your plants ', { text: 'less', background: '#FFD84D', padding: 12 }, ', not more.'], fontFamily: 'Playfair Display', fontSize: 104, fontWeight: 700, lineHeight: 1.08, color: '#14131A' },
      { type: 'text', x: 90, y: 470, height: 220, text: 'Most houseplants die of too much water.\nIf the top 3 cm of soil are dry, it’s time.', fontSize: 38, lineHeight: 1.4, color: '#3B3846' },
      { type: 'text', x: 90, y: 940, height: 60, text: '@greenroom.studio', fontSize: 34, fontWeight: 700, gradient: { angle: 90, stops: [{ color: '#1F7A5A' }, { color: '#3B5BFF' }] } },
    ],
  },
  image: {
    width: 1080, height: 1080, background: '#1F3A5F',
    nodes: [
      { type: 'image', src: HOUSE, x: 90, y: 90, width: 900, height: 600, borderRadius: 36 },
      { type: 'image', src: PORTRAIT, x: 750, y: 600, width: 250, height: 250, mask: 'circle', filters: { grayscale: 100, contrast: 110 } },
      { type: 'text', x: 90, y: 760, width: 620, height: 220, text: 'Meet Ana, the architect behind the house.', fontSize: 54, fontWeight: 700, lineHeight: 1.12, color: '#FFFFFF' },
    ],
  },
  shape: {
    width: 1080, height: 1080, background: '#FFFFFF',
    nodes: [
      { type: 'shape', shape: 'ellipse', x: 620, y: -160, width: 600, height: 600, fill: '#FFD84D' },
      { type: 'text', x: 90, y: 130, width: 600, height: 340, text: 'Rectangles, circles, pills and lines.', fontFamily: 'Poppins', fontSize: 76, fontWeight: 700, lineHeight: 1.05, color: '#14131A' },
      { type: 'shape', x: 90, y: 560, width: 900, height: 6, fill: '#14131A' },
      { type: 'shape', x: 110, y: 660, width: 300, height: 300, fill: '#3B5BFF', borderRadius: 28, rotation: 10 },
      { type: 'shape', x: 520, y: 730, width: 470, height: 130, fill: 'transparent', borderRadius: 65, stroke: { color: '#14131A', width: 6 } },
      { type: 'text', x: 520, y: 730, width: 470, height: 130, text: 'A pill outline', fontSize: 44, fontWeight: 700, color: '#14131A', textAlign: 'center', verticalAlign: 'middle' },
    ],
  },
  gradient: {
    width: 1080, height: 1080, background: { type: 'linear', angle: 135, stops: [{ color: '#3B5BFF' }, { color: '#E4572E' }] },
    nodes: [
      { type: 'gradient', x: 380, y: -360, width: 1060, height: 1060, gradient: { type: 'radial', stops: [{ color: '#FFD84D', opacity: 0.9, position: 0 }, { color: '#FFD84D', opacity: 0, position: 70 }] } },
      { type: 'gradient', x: 90, y: 700, width: 900, height: 290, borderRadius: 32, gradient: { angle: 90, stops: [{ color: '#14131A', opacity: 0.85 }, { color: '#14131A', opacity: 0.35 }] } },
      { type: 'text', x: 140, y: 700, width: 800, height: 290, text: 'Gradients for backgrounds, glows and overlays.', fontSize: 56, fontWeight: 700, lineHeight: 1.12, color: '#FFFFFF', verticalAlign: 'middle' },
    ],
  },
  carousel: {
    width: 1080, height: 1350, background: '#14131A',
    slides: [
      { nodes: [
        { type: 'image', src: ROOM, x: 0, y: 0, width: 1080, height: 1350 },
        { type: 'gradient', x: 0, y: 500, width: 1080, height: 850, gradient: { angle: 180, stops: [{ color: '#14131A', opacity: 0 }, { color: '#14131A', opacity: 0.92 }] } },
        { type: 'text', x: 80, y: 820, height: 330, text: '3 ways to make a small room feel bigger', fontFamily: 'Poppins', fontSize: 88, fontWeight: 700, lineHeight: 1.05, color: '#FFFFFF' },
        { type: 'text', x: 80, y: 1190, height: 60, text: 'Swipe for the first one', fontSize: 34, fontWeight: 700, color: '#FFD84D' },
      ] },
      { background: '#F6F3EA', nodes: [
        { type: 'text', x: 80, y: 110, height: 140, text: '01', fontFamily: 'Poppins', fontSize: 120, fontWeight: 700, color: '#F2A900' },
        { type: 'text', x: 80, y: 300, height: 260, text: 'Paint the ceiling lighter than the walls', fontFamily: 'Poppins', fontSize: 72, fontWeight: 700, lineHeight: 1.08, color: '#14131A' },
        { type: 'text', x: 80, y: 520, height: 400, text: 'A light ceiling reflects more light and reads as higher. Matte white works in almost any room.', fontSize: 40, lineHeight: 1.45, color: '#3B3846' },
        { type: 'shape', x: 80, y: 1200, width: 920, height: 4, fill: '#14131A', opacity: 0.15 },
      ] },
      { background: '#FFD84D', nodes: [
        { type: 'text', x: 80, y: 80, height: 1190, text: 'Want the other two? Save this post.', fontFamily: 'Poppins', fontSize: 96, fontWeight: 700, lineHeight: 1.05, color: '#14131A', verticalAlign: 'middle' },
      ] },
    ],
  },
}

export const ERRORS = [
  [400, 'invalid_request', 'The body is not valid; the message names the property, such as "nodes[2].fontSize" must be from 6 to 600.'],
  [401, 'authentication_error', 'The key is missing, not valid, or revoked.'],
  [402, 'insufficient_credits', 'The balance is too low. The error says how many credits were needed and what is left.'],
  [404, 'not_found', 'There is no such endpoint.'],
  [405, 'invalid_request', '/v1/posts takes POST.'],
  [413, 'invalid_request', 'The body is larger than 4 MB. Send big images as URLs instead of data URLs.'],
  [422, 'image_unavailable', 'An image could not be loaded: the message names it and says why.'],
  [429, 'rate_limited', `More than ${RATE_LIMITS.perKey} requests a minute on one key. Wait the seconds in the Retry-After header.`],
  [500, 'server_error', 'Something failed on our side. Nothing was charged; try again.'],
]

export const LIMIT_ROWS = [
  ['Post size', `${LIMITS.minSize} to ${LIMITS.maxWidth} px wide, ${LIMITS.minSize} to ${LIMITS.maxHeight} px high`],
  ['Nodes', `${LIMITS.maxNodes} per post or slide`],
  ['Slides', `2 to ${LIMITS.maxSlides} per carousel`],
  ['Images', `${IMAGE_LIMITS.maxImages} different images per request, ${IMAGE_LIMITS.maxBytes / 1024 / 1024} MB each`],
  ['Request body', '4 MB'],
  ['Requests', `${RATE_LIMITS.perKey} a minute per key`],
  ['Cost', `${CREDIT_COSTS.image} credit per image`],
]

const indent = (text, spaces) => text.split('\n').map((line, i) => (i ? ' '.repeat(spaces) + line : line)).join('\n')
const pythonValue = value => JSON.stringify(value, null, 4).replace(/: true\b/g, ': True').replace(/: false\b/g, ': False').replace(/: null\b/g, ': None')

/**
 * Code that sends a document and saves the image: cURL, JavaScript (Node 18+) and Python (requests). With `inline`
 * the document is written into the code; otherwise it is read from post.json.
 */
export function codeExamples(base, document, { inline = false, file = document.slides && document.slide == null ? 'carousel.zip' : 'post.png' } = {}) {
  const url = `${base}/v1/posts`
  const json = JSON.stringify(document, null, 2)
  const curl = `curl ${url} \\\n  -H "Authorization: Bearer $BATKLE_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  ${inline ? `-d '${indent(json, 2)}'` : '-d @post.json'} \\\n  --output ${file}`
  const javascript = `import { ${inline ? '' : 'readFile, '}writeFile } from 'node:fs/promises'\n\n${inline ? `const post = ${json}` : "const post = JSON.parse(await readFile('post.json', 'utf8'))"}\n\nconst res = await fetch('${url}', {\n  method: 'POST',\n  headers: {\n    Authorization: \`Bearer \${process.env.BATKLE_API_KEY}\`,\n    'Content-Type': 'application/json',\n  },\n  body: JSON.stringify(post),\n})\nif (!res.ok) throw new Error((await res.json()).error.message)\nawait writeFile('${file}', Buffer.from(await res.arrayBuffer()))`
  const python = `${inline ? '' : 'import json\n'}import os\nimport requests\n\n${inline ? `post = ${pythonValue(document)}` : 'post = json.load(open("post.json"))'}\n\nres = requests.post(\n    "${url}",\n    headers={"Authorization": f"Bearer {os.environ['BATKLE_API_KEY']}"},\n    json=post,\n    timeout=120,\n)\nif not res.ok:\n    raise RuntimeError(res.json()["error"]["message"])\nopen("${file}", "wb").write(res.content)`
  return { curl, javascript, python }
}
