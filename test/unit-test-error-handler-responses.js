import superagentDefaults from 'superagent-defaults'
import supertest from 'supertest'

import appFactory from '../src/app.js'

import { BaseTest, runTests } from './base-test.js'

// What callers see when a request fails, with error detail off as in prod.
class ErrorHandlerResponseTest extends BaseTest {
  async beforeAll () {
    await super.beforeAll()
    this.fastify = await appFactory({ logging: { reportErrorDetail: false } })
    await this.fastify.ready()
    this.app = superagentDefaults(supertest(this.fastify.server))
    this.app.set('accept-encoding', null)
  }

  async afterAll () {
    await this.fastify.close()
    await super.afterAll()
  }

  async testCrashMessageIsNotReturned () {
    // e.g., firestore-orm's read-only-write error quotes the model it tried
    // to save, secrets and all
    const message = 'tried to write {"apiKeySecret":"s3cr3t"}'
    const resp = await this.app.post('/sentryRateLimited')
      .send({ message, plain: true })
      .expect(500)
    expect(resp.body).toEqual({ code: 'Error', message: 'internal server error' })
    expect(resp.text).not.toContain('s3cr3t')
  }

  async testDeliberate500KeepsItsMessage () {
    const resp = await this.app.post('/sentryRateLimited')
      .send({ message: 'meant for the caller' })
      .expect(550)
    expect(resp.body).toEqual({ code: 'RequestError', message: 'meant for the caller' })
  }

  async testClientErrorKeepsItsMessage () {
    // a RequestError
    let resp = await this.app.post('/sentryRateLimited')
      .send({ message: 'not yours', code: 403 })
      .expect(403)
    expect(resp.body).toEqual({ code: 'RequestError', message: 'not yours' })

    // and one of fastify's own
    resp = await this.app.post('/sentryRateLimited')
      .set('Content-Type', 'text/html')
      .send('{}')
      .expect(415)
    expect(resp.body.message).toContain('Content-Type Not Permitted')
  }
}

runTests(ErrorHandlerResponseTest)
