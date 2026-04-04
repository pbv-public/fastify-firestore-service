import { jest } from '@jest/globals'
import superagentDefaults from 'superagent-defaults'
import supertest from 'supertest'

import { BaseTest, runTests } from './base-test.js'

// Mock @sentry/node BEFORE importing modules that use it. ESM exports are
// read-only, so jest.spyOn doesn't work -- jest.unstable_mockModule replaces
// the module at import time instead.
const mockCaptureException = jest.fn()
const capturedScopes = [] // each entry: { tags, extras, level }

jest.unstable_mockModule('@sentry/node', () => ({
  init: jest.fn(),
  captureException: mockCaptureException,
  withScope: fn => {
    const tags = {}
    const extras = {}
    let level
    const scope = {
      setFingerprint: () => {},
      setLevel: l => { level = l },
      setUser: () => {},
      setTags: t => Object.assign(tags, t),
      setContext: () => {},
      setExtras: e => Object.assign(extras, e)
    }
    fn(scope)
    capturedScopes.push({ tags, extras, level })
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
}

runTests(ErrorHandlerSentryRateLimitTest)
