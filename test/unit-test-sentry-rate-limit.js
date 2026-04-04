import { createSentryRateLimiter } from '../src/plugins/sentry-rate-limit.js'

import { BaseTest, runTests } from './base-test.js'

class SentryRateLimiterTest extends BaseTest {
  beforeEach () {
    this.now = 1_000_000
    this.rl = createSentryRateLimiter(() => this.now)
  }

  testFirstEventIsReported () {
    const result = this.rl.shouldReport('k', 60_000)
    expect(result.report).toBe(true)
    expect(result.suppressedCount).toBe(0)
  }

  testWithinWindowIsSuppressed () {
    this.rl.shouldReport('k', 60_000)
    this.now += 30_000
    const result = this.rl.shouldReport('k', 60_000)
    expect(result.report).toBe(false)
    expect(result.suppressedCount).toBe(0)
  }

  testAfterWindowReportsWithSuppressedCount () {
    this.rl.shouldReport('k', 60_000)
    this.now += 1_000
    this.rl.shouldReport('k', 60_000)
    this.rl.shouldReport('k', 60_000)
    this.now += 60_000 // now past the window
    const result = this.rl.shouldReport('k', 60_000)
    expect(result.report).toBe(true)
    expect(result.suppressedCount).toBe(2)
  }

  testSuppressedCountResetsAfterReport () {
    this.rl.shouldReport('k', 60_000)
    this.now += 1_000
    this.rl.shouldReport('k', 60_000) // suppressed
    this.now += 60_000
    const first = this.rl.shouldReport('k', 60_000) // reports, suppressed=1
    expect(first.suppressedCount).toBe(1)
    this.now += 60_000
    const second = this.rl.shouldReport('k', 60_000) // reports, suppressed=0
    expect(second.report).toBe(true)
    expect(second.suppressedCount).toBe(0)
  }

  testDifferentKeysIndependent () {
    this.rl.shouldReport('a', 60_000)
    this.rl.shouldReport('b', 60_000)
    this.now += 1_000
    expect(this.rl.shouldReport('a', 60_000).report).toBe(false)
    expect(this.rl.shouldReport('b', 60_000).report).toBe(false)
  }

  testExactlyAtWindowBoundaryIsReported () {
    // > window means a fresh report; at-exactly is fresh too (now - last >= window)
    this.rl.shouldReport('k', 60_000)
    this.now += 60_000
    const result = this.rl.shouldReport('k', 60_000)
    expect(result.report).toBe(true)
  }

  testDefaultNowFnUsesDateNow () {
    // If no clock is injected, Date.now is used -- just verify it doesn't
    // throw. Behavior is the same, we just can't time-travel.
    const rl = createSentryRateLimiter()
    expect(rl.shouldReport('k', 60_000).report).toBe(true)
    expect(rl.shouldReport('k', 60_000).report).toBe(false)
  }
}

runTests(SentryRateLimiterTest)
