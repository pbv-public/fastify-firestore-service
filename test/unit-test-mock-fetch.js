import zlib from 'node:zlib'

import fetchWrapper from '../src/fetch-wrapper.js'

import { BaseAppTest, runTests } from './base-test.js'

// Tests to make sure new JS features introduced in node14
// are working, and context highlight, linter etc are compatible
class MockFetchTest extends BaseAppTest {
  async testMustProvideSomeMockValue () {
    const mockedFetch = this.fetchMock
    mockedFetch.mockRespWithCallback(() => null)
    const promise = fetchWrapper({ url: '/testMustProvideSomeMockValue' })
    await expect(promise).rejects.toThrow('un-mocked fetchWrapper() request')
  }

  async testCallbackWithBodyNotCompressed () {
    const mockedFetch = this.fetchMock
    mockedFetch.mockRespWithCallback(request => {
      // no compression so we just pass it as-is
      expect(request.json).toEqual({ tbd: true })
      return {}
    })
    const resp = await fetchWrapper({
      url: '/testCallbackWithBody',
      compress: false,
      json: {
        tbd: true
      }
    })
    expect(resp.status).toBe(200)
    expect(await resp.text()).toBe('')
  }

  async testCallbackWithBodyCompressed () {
    const mockedFetch = this.fetchMock
    mockedFetch.mockRespWithCallback(request => {
      // the request we see in our callback should be what's passed to
      // fetchWrapper() NOT wha tis passed to node-fetch!
      expect(request.json).toEqual({ tbd: true })
      return {}
    })
    const respWithCompression = await fetchWrapper({
      url: '/testCallbackWithBody',
      // compression is true by default
      json: {
        tbd: true
      }
    })
    expect(respWithCompression.status).toBe(200)
    expect(await respWithCompression.text()).toBe('')
  }

  async testDefaultMockResp () {
    const mockedFetch = this.fetchMock
    mockedFetch.mockResp()
    const resp = await fetchWrapper({ url: '/testDefaultMockResp' })
    expect(resp.status).toBe(200)
    expect(await resp.text()).toBe('')
  }

  async testMockRespMulti () {
    const mockedFetch = this.fetchMock
    mockedFetch.mockRespMulti(
      [], // default
      ['custom text'],
      ['custom code too', 222],
      [{ x: 'json ok too' }, 223]
    )
    const expResponses = [
      { text: '', code: 200 },
      { text: 'custom text', code: 200 },
      { text: 'custom code too', code: 222 },
      { text: '{"x":"json ok too"}', code: 223 },
      // one too many calls!
      { text: 'ran out of mocked responses', code: 556 }
    ]
    for (const { text: expText, code: expCode } of expResponses) {
      const resp = await fetchWrapper({ url: '/testMockRespMulti' })
      expect(resp.status).toBe(expCode)
      expect(await resp.text()).toBe(expText)
    }
  }

  async testDefaultResp () {
    const resp = await fetchWrapper({ url: '/testDefaultMockResp' })
    expect(resp.status).toBe(555)
    expect(await resp.text()).toBe('custom mock value not set')
  }

  async testRealAPICallToTheInternet () {
    const mockedFetch = this.fetchMock
    // can tell the mock to allow a real request to the Internet (probably not
    // a good testing strategy, but it is supported)
    mockedFetch.mockRespWithCallback(() => true)
    const resp = await fetchWrapper({ method: 'GET', url: 'https://www.google.com/' })
    const respData = await resp.text()
    expect(resp.status).toBe(200)
    expect(respData).toMatch(/<html/)

    // real is also used when mock is not set
    const origMock = fetchWrapper.__mock
    delete fetchWrapper.__mock
    const resp2 = await fetchWrapper({ method: 'GET', url: 'https://www.google.com/' })
    try {
      const resp2Data = await resp2.text()
      expect(resp2.status).toBe(200)
      expect(resp2Data).toMatch(/<html/)
    } finally {
      fetchWrapper.__mock = origMock
    }
  }

  async testMockValueFromCallback () {
    const mockedFetch = this.fetchMock
    let numCalls = 0
    // test subsequent calls giving different responses
    mockedFetch.mockRespWithCallback(() => {
      numCalls += 1
      // the mock can simply proxy a supertest call to some API
      if (numCalls === 1) {
        return this.app.post('/defaultValue')
          .set('Content-Type', 'application/json')
          .send({ v: 10 })
      }
      // the mock can provide a specific response as text
      if (numCalls === 2) {
        return { status: 552, text: 'just testing' }
      }
      // ... or JSON
      if (numCalls === 3) {
        return { status: 553, body: { x: 3 } }
      }
      // ... or nothing at all (empty response)
      if (numCalls === 4) {
        return { status: 554 }
      }
      if (numCalls === 5) {
        return {}
      }
      if (numCalls === 6) {
        return new Promise(resolve => {
          return resolve({ body: { x: 6 } })
        })
      }
      if (numCalls === 7) {
        return new Promise(resolve => {
          return resolve({})
        })
      }
      throw new Error('this test should not call the mock more than 7 times')
    })

    // first call should just proxy the /defaultValue API
    const resp1 = await fetchWrapper({ url: '/testOne' })
    expect(resp1.status).toBe(200)
    const resp1Data = await resp1.text()
    expect(JSON.parse(resp1Data)).toEqual({ v: 10 })

    // calls 2-4 should provide a specific response in different ways
    let expCode = 551
    for (const expBody of ['just testing', JSON.stringify({ x: 3 }), '']) {
      expCode += 1
      const resp = await fetchWrapper({ url: `/whateverItsMocked${expCode}` })
      expect(resp.status).toBe(expCode)
      const respData = await resp.text()
      expect(respData).toBe(expBody)
    }
    expect(expCode).toBe(554) // should've run 3 tests
    const resp5 = await fetchWrapper({ url: '/call5' })
    expect(resp5.status).toBe(200)
    const respData5 = await resp5.text()
    expect(respData5).toBe('')

    // test custom promise (not from supertest)
    const resp6 = await fetchWrapper({ url: '/call6' })
    expect(resp6.status).toBe(200)
    const respData6 = await resp6.text()
    expect(JSON.parse(respData6)).toEqual({ x: 6 })
    const respNoBody = await fetchWrapper({ url: '/call7' })
    expect(respNoBody.status).toBe(200)
    const respDataNoBody = await respNoBody.text()
    expect(respDataNoBody).toEqual('')
  }
}

runTests(MockFetchTest)
