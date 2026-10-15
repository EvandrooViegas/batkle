// `npm run dev`: next dev, plus the Stripe CLI forwarding test-mode webhooks to it, so checkouts update the account
// on this computer too. The CLI signs what it forwards with its own secret, which this hands to Next as
// STRIPE_WEBHOOK_SECRET (it wins over the one in .env.local, which is the Dashboard endpoint's). Without the CLI or a
// test key in STRIPE_SECRET_KEY it says why and runs next dev alone.
//   npm run dev                  options after -- go to next dev: npm run dev -- -p 3001
// Install the CLI with `winget install Stripe.StripeCli` (Windows) or `brew install stripe/stripe-cli/stripe` (macOS).
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const readline = require('node:readline')
const { WEBHOOK_EVENTS } = require('./stripe-setup.cjs')

const ROOT = path.join(__dirname, '..')

/** A variable as next dev will see it: the environment first, then the .env files in Next's order. */
function envValue(name) {
  if (process.env[name]) return process.env[name]
  for (const file of ['.env.development.local', '.env.local', '.env.development', '.env']) {
    const full = path.join(ROOT, file)
    const value = fs.existsSync(full) && require('dotenv').parse(fs.readFileSync(full))[name]
    if (value) return value.trim()
  }
}

/** The Stripe CLI: on PATH, or where winget put it (a terminal opened before the install doesn't have it on PATH). */
function findStripe() {
  const name = process.platform === 'win32' ? 'stripe.exe' : 'stripe'
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  if (process.env.LOCALAPPDATA) {
    const winget = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet')
    const packages = path.join(winget, 'Packages')
    dirs.push(path.join(winget, 'Links'))
    if (fs.existsSync(packages)) {
      dirs.push(...fs.readdirSync(packages).filter(dir => dir.startsWith('Stripe.StripeCli_')).map(dir => path.join(packages, dir)))
    }
  }
  return dirs.map(dir => path.join(dir, name)).find(file => fs.existsSync(file))
}

function isFree(port) {
  return new Promise(resolve => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port)
  })
}

/**
 * The port next dev will listen on, so the webhooks go there: the one asked for, or else the first free one from
 * 3000, passed on with -p (next dev would move past a busy 3000 by itself, out of sight of the forwarding).
 */
async function pickPort(args) {
  const flag = args.findIndex(arg => arg === '-p' || arg === '--port')
  const asked = flag >= 0 ? args[flag + 1] : args.find(arg => arg.startsWith('--port='))?.slice('--port='.length)
  if (asked || process.env.PORT) return { port: Number(asked || process.env.PORT), args }
  let port = 3000
  while (!(await isFree(port))) port++
  return { port, args: [...args, '-p', String(port)] }
}

/** Starts `stripe listen` towards the port and returns its signing secret, or says why it didn't and returns nothing. */
function startStripe(port, children) {
  const key = envValue('STRIPE_SECRET_KEY')
  const skip = reason => console.log(`[stripe] ${reason}; Stripe webhooks won't reach this server.`)
  if (!key) return skip('No STRIPE_SECRET_KEY')
  if (!/^[sr]k_test_/.test(key)) return skip('STRIPE_SECRET_KEY is not a test key (sk_test_…), and live events stay off this computer')
  const stripe = findStripe()
  if (!stripe) return skip('The Stripe CLI is not installed (winget install Stripe.StripeCli, then open a new terminal)')

  const env = { ...process.env, STRIPE_API_KEY: key }
  const printed = spawnSync(stripe, ['listen', '--print-secret'], { env, encoding: 'utf8', timeout: 30000 })
  const secret = printed.stdout?.match(/whsec_\w+/)?.[0]
  if (!secret) return skip(`The Stripe CLI gave no signing secret (${(printed.error?.message || printed.stderr || '').trim().split('\n')[0]})`)

  const url = `localhost:${port}/api/stripe/webhook`
  const listener = spawn(stripe, ['listen', '--forward-to', url, '--events', WEBHOOK_EVENTS.join(',')], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  for (const stream of [listener.stdout, listener.stderr]) {
    readline.createInterface({ input: stream }).on('line', line => {
      if (line.trim() && !line.startsWith('<claude-code-hint')) console.log(`[stripe] ${line}`)
    })
  }
  listener.on('exit', code => {
    if (!listener.stopping) console.log(`[stripe] stripe listen stopped (exit code ${code}); webhooks no longer reach this server.`)
  })
  children.push(listener)
  console.log(`[stripe] Forwarding test-mode webhooks to ${url}`)
  return secret
}

async function main() {
  const { port, args } = await pickPort(process.argv.slice(2))
  const children = []
  const secret = startStripe(port, children)
  const env = secret ? { ...process.env, STRIPE_WEBHOOK_SECRET: secret } : process.env
  const next = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', ...args], { cwd: ROOT, env, stdio: 'inherit' })
  children.push(next)
  const stopAll = signal => children.forEach(child => { child.stopping = true; child.kill(signal) })
  // Ctrl+C reaches every process in the terminal; this waits for next dev to stop rather than leaving it behind.
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stopAll(signal))
  next.on('exit', (code, signal) => {
    stopAll()
    process.exit(code ?? (signal ? 1 : 0))
  })
}

main().catch(error => { console.error(error); process.exit(1) })
