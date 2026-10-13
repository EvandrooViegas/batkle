const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')
const { publicMessage, BUSY_MESSAGE, UNAVAILABLE_MESSAGE, FAILED_MESSAGE, COPY_FAILED_MESSAGE } = new Function(
  stripTypeScriptTypes(fs.readFileSync('lib/services/publicError.ts', 'utf8').replace(/export /g, ''))
  + ';return {publicMessage,BUSY_MESSAGE,UNAVAILABLE_MESSAGE,FAILED_MESSAGE,COPY_FAILED_MESSAGE}',
)()

test('provider accounts, keys and billing never reach people', () => {
  for (const internal of [
    'OpenAI has no credits left, so AI images cannot be generated. Add credits at https://platform.openai.com/settings/organization/billing',
    'GROQ_API_KEY is not configured',
    'GPT Image 2.5 requires OPENAI_API_KEY in the server environment',
    'Pollinations: POLLINATIONS_API_KEY is not configured',
    'No supported copywriting chat model is available in this Groq account. Check your project model permissions.',
    'Multilingual description indexing requires a configured Groq API key',
    'fal: HTTP 402 (no balance left)',
  ]) assert.equal(publicMessage(internal), UNAVAILABLE_MESSAGE, internal)
})

test('technical failures become a plain message', () => {
  for (const internal of [
    'AI returned invalid JSON',
    'Empty response from AI',
    'Groq call failed after retries',
    'GPT Image 2.5: HTTP 500',
    "Cannot read properties of undefined (reading 'nodes')",
    'TypeError: fetch failed',
    'connect ECONNREFUSED 127.0.0.1:27017',
    'MongoServerError: you are over your space quota',
    'Internal server error',
  ]) assert.equal(publicMessage(internal), FAILED_MESSAGE, internal)
  assert.equal(publicMessage('You exceeded your current quota, please check your plan and billing details.'), UNAVAILABLE_MESSAGE, 'an exhausted account is not a wait')
  assert.equal(publicMessage(''), FAILED_MESSAGE)
  assert.equal(publicMessage(undefined), FAILED_MESSAGE)
})

test('rate limits say to wait, keeping the wait time', () => {
  assert.equal(publicMessage('AI quota reached. Retry in 30 seconds.', 429), 'Batkle is busy right now. Please try again in 30 seconds.')
  assert.equal(publicMessage('GPT Image 2.5: rate limited by OpenAI; try again in a minute'), BUSY_MESSAGE)
  assert.equal(publicMessage('Too many requests', 429), BUSY_MESSAGE)
})

test('a failed copy names no validation reason', () => {
  assert.equal(publicMessage('AI could not generate complete, valid copywriting (The carousel has 7 slides but the brief’s outline has 5 entries). Please retry; your saved content is unchanged.', 502), COPY_FAILED_MESSAGE)
})

test('messages written for people pass unchanged', () => {
  for (const message of [
    'Brand not found',
    'A single post shows one photo. Choose Carousel or Auto to use all your photos.',
    'A photo is already used in another post. Each photo can be used once.',
    'The design you picked uses typography only, so it cannot show your photos. Pick a design with images in the post settings, or Auto.',
    'This design is not in the brand’s library.',
    'Upload a PNG, JPEG or WebP reference.',
    'Each reference must be under 6 MB.',
    'Your changes could not be saved',
  ]) assert.equal(publicMessage(message, 400), message)
})
