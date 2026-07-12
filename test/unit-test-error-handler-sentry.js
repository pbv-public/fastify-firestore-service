import { jest } from '@jest/globals'
import superagentDefaults from 'superagent-defaults'
import supertest from 'supertest'

import { BaseTest, runTests } from './base-test.js'

// Mock @sentry/node BEFORE importing modules that use it. ESM exports are
// read-only, so jest.spyOn doesn't work -- jest.unstable_mockModule replaces
// the module at import time instead.
const mockCaptureException = jest.fn()
const capturedScopes = [] // each entry: { tags, extras, level, fingerprint }

jest.unstable_mockModule('@sentry/node', () => ({
  init: jest.fn(),
  captureException: mockCaptureException,
  withScope: fn => {
    const tags = {}
    const extras = {}
    let level
    let fingerprint
    const scope = {
      setFingerprint: f => { fingerprint = f },
      setLevel: l => { level = l },
      setUser: () => {},
      setTags: t => Object.assign(tags, t),
      setContext: () => {},
      setExtras: e => Object.assign(extras, e)
    }
    fn(scope)
    capturedScopes.push({ tags, extras, level, fingerprint })
  }
}))

// Dynamic imports so they use the mocked @sentry/node above.
const { default: appFactory } = await import('../src/app.js')
const { createSentryRateLimiter } = await import('../src/plugins/sentry-rate-limit.js')
const { EXCEPTIONS } = await import('../src/index.js')

class ErrorHandlerSentryRateLimitTest extends BaseTest {
  async beforeAll () {
    await super.beforeAll()
    this.now = 1_000_000
    this.rateLimiter = createSentryRateLimiter(() => this.now)
    // Build our own fastify with a clock-controlled rate limiter. We don't
    // use BaseAppTest's FASTIFY_CACHE because that caches a default-configured
    // instance.
    this.fastify = await appFactory({
      logging: {
        reportAllErrors: true,
        reportErrorDetail: true,
        sentryRateLimiter: this.rateLimiter
      }
    })
    await this.fastify.ready()
    this.app = superagentDefaults(supertest(this.fastify.server))
    this.app.set('accept-encoding', null)
  }

  async afterAll () {
    await this.fastify.close()
    await super.afterAll()
  }

  beforeEach () {
    mockCaptureException.mockClear()
    capturedScopes.length = 0
  }

  async throwErr (message, { rateLimit = false, windowMs } = {}) {
    const body = { message, rateLimit }
    if (windowMs !== undefined) body.windowMs = windowMs
    await this.app.post('/sentryRateLimited').send(body).expect(550)
  }

  async throwClientErr (message, { code = 403, force = false, rateLimit = false, windowMs } = {}) {
    const body = { message, code, force, rateLimit }
    if (windowMs !== undefined) body.windowMs = windowMs
    await this.app.post('/sentryRateLimited').send(body).expect(code)
  }

  async testNonRateLimitedErrorIsAlwaysCaptured () {
    await this.throwErr('plain err A')
    await this.throwErr('plain err A')
    await this.throwErr('plain err A')
    expect(mockCaptureException).toHaveBeenCalledTimes(3)
    expect(capturedScopes.every(s => !('suppressedSimilarEvents' in s.tags))).toBe(true)
  }

  async testRateLimitedErrorCapturedOncePerWindow () {
    await this.throwErr('rl err A', { rateLimit: true, windowMs: 60_000 })
    expect(mockCaptureException).toHaveBeenCalledTimes(1)
    this.now += 1_000
    await this.throwErr('rl err A', { rateLimit: true, windowMs: 60_000 })
    expect(mockCaptureException).toHaveBeenCalledTimes(1) // suppressed
    this.now += 1_000
    await this.throwErr('rl err A', { rateLimit: true, windowMs: 60_000 })
    expect(mockCaptureException).toHaveBeenCalledTimes(1) // still suppressed
  }

  async testSuppressedCountExposedAsTagOnNextReport () {
    await this.throwErr('rl err B', { rateLimit: true, windowMs: 60_000 })
    this.now += 1_000
    await this.throwErr('rl err B', { rateLimit: true, windowMs: 60_000 })
    await this.throwErr('rl err B', { rateLimit: true, windowMs: 60_000 })
    this.now += 60_000
    await this.throwErr('rl err B', { rateLimit: true, windowMs: 60_000 })
    expect(mockCaptureException).toHaveBeenCalledTimes(2)
    // first capture: no suppression tag; second capture: suppressedSimilarEvents=2
    expect(capturedScopes[0].tags.suppressedSimilarEvents).toBe(undefined)
    expect(capturedScopes[1].tags.suppressedSimilarEvents).toBe('2')
  }

  async testDefaultWindowUsed () {
    await this.throwErr('rl err C', { rateLimit: true })
    this.now += 30_000
    await this.throwErr('rl err C', { rateLimit: true })
    expect(mockCaptureException).toHaveBeenCalledTimes(1) // still within default 5min
  }

  testRateLimitSentryReturnsSelfForChaining () {
    const err = new EXCEPTIONS.RequestError('x', undefined, 550)
    expect(err.rateLimitSentry()).toBe(err)
    expect(err._sentryRateLimitMs).toBe(5 * 60 * 1000)
    expect(err.rateLimitSentry(1234)._sentryRateLimitMs).toBe(1234)
  }

  async testCrashCapturedAsErrorLevel () {
    await this.throwErr('crash err A')
    expect(mockCaptureException).toHaveBeenCalledTimes(1)
    expect(capturedScopes[0].level).toBe('error')
  }

  async testClientErrorNotCaptured () {
    await this.throwClientErr('client err A', { code: 403 })
    await this.throwClientErr('client err A', { code: 400 })
    expect(mockCaptureException).toHaveBeenCalledTimes(0)
  }

  async testForcedClientErrorCaptured () {
    await this.throwClientErr('client err B', { code: 403, force: true })
    expect(mockCaptureException).toHaveBeenCalledTimes(1)
    expect(capturedScopes[0].level).toBe('warning')
    expect(capturedScopes[0].tags.status).toBe(403)
  }

  async testForcedClientErrorRespectsRateLimit () {
    const opts = { code: 429, force: true, rateLimit: true, windowMs: 60_000 }
    await this.throwClientErr('client err C', opts)
    expect(mockCaptureException).toHaveBeenCalledTimes(1)
    this.now += 1_000
    await this.throwClientErr('client err C', opts)
    expect(mockCaptureException).toHaveBeenCalledTimes(1) // suppressed
  }

  async testUnforcedClientErrorSkipsRateLimiter () {
    // An unforced client error is never captured AND does not consume the
    // rate limiter's budget...
    await this.throwClientErr('client err D', { rateLimit: true, windowMs: 60_000 })
    expect(mockCaptureException).toHaveBeenCalledTimes(0)
    // ...so a forced report immediately after still goes out.
    this.now += 1_000
    await this.throwClientErr('client err D', { rateLimit: true, windowMs: 60_000, force: true })
    expect(mockCaptureException).toHaveBeenCalledTimes(1)
  }

  testForceSentryReturnsSelfForChaining () {
    const err = new EXCEPTIONS.RequestError('x', undefined, 400)
    expect(err.forceSentry()).toBe(err)
    expect(err._sentryForceReport).toBe(true)
  }

  async testThirdPartyStatusCodeErrorNormalizedTo500AndCaptured () {
    // An error carrying a statusCode that was NOT thrown through our
    // exception classes (e.g., a third-party HTTP client error that escaped
    // uncaught) is normalized to a 500 crash by the API layer and always
    // captured -- it must never be mistaken for an expected client error.
    await this.app.post('/sentryRateLimited')
      .send({ message: 'mailjet says no', code: 401, plain: true })
      .expect(500)
    await this.app.post('/sentryRateLimited')
      .send({ message: 'boom', plain: true }) // no code -> defaults to 550
      .expect(500)
    expect(mockCaptureException).toHaveBeenCalledTimes(2)
    expect(capturedScopes.every(s => s.level === 'error')).toBe(true)
    expect(capturedScopes[0].tags.status).toBe(500)
  }

  async testFastifyInternalClientErrorStillCaptured () {
    // fastify's own content-type error is not a RequestError either; it
    // stays captured (with its custom fingerprint) as before.
    await this.app.post('/sentryRateLimited')
      .set('Content-Type', 'text/html')
      .send('{}')
      .expect(415)
    expect(mockCaptureException).toHaveBeenCalledTimes(1)
    expect(capturedScopes[0].fingerprint).toBe('Content-Type Not Permitted')
  }
}

runTests(ErrorHandlerSentryRateLimitTest)
