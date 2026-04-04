import S from '@pbvision/schema'
import * as Sentry from '@sentry/node'
import fp from 'fastify-plugin'

import { InvalidInputException, __RequestDone } from '../api/exception.js'
import { createSentryRateLimiter } from './sentry-rate-limit.js'

export default fp(function (fastify, options, next) {
  const isLocalhost = process.env.NODE_ENV === 'localhost'
  const sentryDSN = options.errorHandler.sentryDSN
  // istanbul ignore next
  const isSentryEnabled = sentryDSN && !isLocalhost
  Sentry.init({
    dsn: sentryDSN,
    enabled: isSentryEnabled,
    environment: process.env.NODE_ENV,
    release: `${options.errorHandler.service}@${process.env.GIT_HASH ?? 'unknown'}`,
    serverName: options.errorHandler.serverName
  })

  // Opt-in rate limiter: only errors flagged via RequestError.rateLimitSentry()
  // consult this. See sentry-rate-limit.js for details.
  const sentryRateLimiter = options.errorHandler.sentryRateLimiter ??
    createSentryRateLimiter()

  const returnErrorDetail = options.errorHandler.returnErrorDetail
  // log any exception which occurs
  fastify.setErrorHandler(async (error, req, reply) => {
    // extract the relevant bit of the traceback: remove fastify lines
    // istanbul ignore next
    const traceback = error.stack?.split('\n') ?? []
    // istanbul ignore next
    const errorMessage = error.message?.split('\n') ?? ''
    traceback.splice(0, errorMessage.length)
    let removeFromIdx
    if (error instanceof InvalidInputException) {
      removeFromIdx = 1
    } else {
      for (let i = traceback.length - 1; i > 0; i--) {
        const tbLine = traceback[i]
        if (tbLine.indexOf('/fastify/lib') !== -1) {
          removeFromIdx = i + 1
          break
        }
      }
    }
    removeFromIdx = removeFromIdx ?? traceback.length

    traceback.splice(removeFromIdx, traceback.length - removeFromIdx)

    const response = reply.raw
    /* istanbul ignore next */
    const message = error.message || 'empty error message'
    const statusCode = error.httpCode ?? error.statusCode ?? 500
    reply.code(statusCode)
    const errInfo = {
      msg: message,
      req,
      status: statusCode,
      stack: traceback
    }

    // improve the error emitted from bad requests (invalid input)
    const isCrash = errInfo.status >= 500
    let customFingerprint = false
    if (!isCrash) {
      const firstTB = traceback[0]
      /* istanbul ignore else */
      if (firstTB) {
        /* istanbul ignore else */
        if (firstTB.indexOf('fastify/lib/contentTypeParser.js') !== -1) {
          customFingerprint = 'Content-Type Not Permitted'
        } else if (error instanceof S.ValidationError) {
          customFingerprint = message
        }
        /* istanbul ignore next */
        if (customFingerprint) {
          if (customFingerprint.indexOf(errInfo.msg) === -1) {
            // prefix the error message with the custom fingerprint text if the
            // fingerprint didn't already contain all of the error message text
            errInfo.msg = customFingerprint + ': ' + errInfo.msg
          }
          // changing the error name results in a cleaner description on the
          // Sentry dashboard
          error.name = customFingerprint
        }
      }
    }

    Object.getOwnPropertyNames(error).forEach(key => {
      if (key !== 'stack' && key !== 'message') {
        if (!errInfo.error) {
          errInfo.error = {}
        }
        errInfo.error[key] = error[key]
      }
    })
    response.logged = true // don't double-log
    if (statusCode >= 500) {
      reply.log.error(errInfo)
    } else {
      reply.log.info(errInfo)
    }

    // Check if this error is opted in to Sentry rate limiting; if so and we're
    // inside the window, skip Sentry.captureException entirely. The HTTP
    // response and logs are unaffected regardless.
    let shouldCaptureToSentry = true
    let suppressedCount = 0
    const rateLimitMs = error._sentryRateLimitMs
    if (rateLimitMs) {
      const rlKey = customFingerprint || message
      const rlResult = sentryRateLimiter.shouldReport(rlKey, rateLimitMs)
      shouldCaptureToSentry = rlResult.report
      suppressedCount = rlResult.suppressedCount
    }

    if (shouldCaptureToSentry) {
      Sentry.withScope(function (scope) {
        if (customFingerprint) {
          scope.setFingerprint(customFingerprint)
        }
        const user = {}
        // istanbul ignore if
        if (req.headers['x-uid']) {
          user.id = req.headers['x-uid']
        } else {
          user.ip = req.ip
        }
        scope.setLevel(isCrash ? 'error' : 'warning')
        scope.setUser({
          ...user,
          ...(req.__sentry?.userInfo ?? {})
        })
        scope.setTags({
          ...(req.__sentry?.tags ?? {}),
          method: req.method,
          url: req.url,
          status: errInfo.status,
          // Tag -- not extra -- so operators can filter Sentry for "issues
          // where rate-limiting kicked in" during an outage.
          ...(suppressedCount > 0
            ? { suppressedSimilarEvents: String(suppressedCount) }
            : {})
        })
        const customContexts = req.__sentry?.context ?? {}
        for (const [k, v] of Object.entries(customContexts)) {
          scope.setContext(k, v)
        }
        const extras = {
          msg: errInfo.message,
          reqId: req.id,
          userAgent: req.headers['user-agent'] ?? 'not set'
        }
        if (error instanceof __RequestDone) {
          extras.data = error.data
        }
        scope.setExtras(extras)
        Sentry.captureException(error)
      })
    }

    const errorData = error.respData ?? {
      code: error.constructor.name,
      message: customFingerprint || error.message
    }

    // istanbul ignore else
    if (returnErrorDetail && !error.respData) {
      errorData.detail = errInfo.msg
      errorData.stack = errInfo.stack
    }

    await reply.header('Content-Type', 'application/json; charset=utf-8')
      .serializer(o => JSON.stringify(o, null, 2))
      .send(errorData)
  })

  next()
})
