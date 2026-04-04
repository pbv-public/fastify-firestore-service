/**
 * Creates a rate limiter for Sentry event reporting, keyed by an arbitrary
 * string (typically the Sentry fingerprint or error message). State lives in
 * a Map per rate limiter instance: one instance per process is the expected
 * usage.
 *
 * @param {Function} [nowFn=Date.now] clock function (injectable for tests)
 * @returns {Object} rate limiter with one method, {@link shouldReport}.
 */
export function createSentryRateLimiter (nowFn = Date.now) {
  const tracking = new Map()
  return {
    /**
     * Record an event and decide whether it should be reported to Sentry.
     *
     * @param {String} key rate-limit key; typically the error fingerprint or
     *   message so that Sentry grouping lines up with our suppression.
     * @param {Number} windowMs rate-limit window in ms; within this window
     *   after a report, subsequent events for the same key are suppressed.
     * @returns {{report: Boolean, suppressedCount: Number}} when `report` is
     *   true, `suppressedCount` is the number of events suppressed for this
     *   key since the last report (0 if none were suppressed). When `report`
     *   is false, `suppressedCount` is 0 (caller should not surface it).
     */
    shouldReport (key, windowMs) {
      const now = nowFn()
      const state = tracking.get(key)
      if (state && now - state.lastReported < windowMs) {
        state.suppressed++
        return { report: false, suppressedCount: 0 }
      }
      const suppressedCount = state?.suppressed ?? 0
      tracking.set(key, { lastReported: now, suppressed: 0 })
      return { report: true, suppressedCount }
    }
  }
}
