import { makeService } from '../src/index.js'

import { BaseTest, runTests } from './base-test.js'

class makeServiceTest extends BaseTest {
  async testValidation () {
    const commonConfig = {
      service: 'test',
      components: [],
      cookie: { disabled: true },
      healthCheck: { disabled: true }
    }
    await expect(makeService())
      .rejects.toThrow('Missing required value for service')
    await expect(makeService({ ...commonConfig, cookie: { invalid: false } }))
      .rejects.toThrow('Unknown config invalid')
    await makeService({
      ...commonConfig
    })
  }

  async testReqIPComesFromTheProxyNotTheSocket () {
    const app = await makeService({
      service: 'test',
      components: [],
      cookie: { disabled: true },
      healthCheck: { disabled: true }
    })
    app.get('/whoami', async req => ({ ip: req.ip }))
    await app.ready()
    const ipSeenBy = async forwardedFor => {
      const resp = await app.inject({
        method: 'GET',
        url: '/whoami',
        remoteAddress: '10.0.0.1',
        headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}
      })
      return JSON.parse(resp.body).ip
    }
    // the caller's address, as the proxy appended it
    expect(await ipSeenBy('203.0.113.7')).toBe('203.0.113.7')
    // a caller who sent their own X-Forwarded-For cannot displace it: the
    // proxy's entry is last, and that is the one we take
    expect(await ipSeenBy('1.2.3.4, 203.0.113.7')).toBe('203.0.113.7')
    // no proxy in front at all, so the socket is all there is
    expect(await ipSeenBy(null)).toBe('10.0.0.1')
    await app.close()
  }
}

runTests(makeServiceTest)
