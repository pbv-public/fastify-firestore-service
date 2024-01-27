import fetchWrapper from '../src/fetch-wrapper.js'

import { BaseAppTest, runTests } from './base-test.js'

// Tests to make sure new JS features introduced in node14
// are working, and context highlight, linter etc are compatible
class MockFetchTest extends BaseAppTest {
  async testMustProvideSomeMockValue () {
    const mockedFetch = this.fetchMock
    mockedFetch.mockRespWithCallback(cb => null)
    const promise = fetchWrapper({ url: '/testMustProvideSomeMockValue' })
    await expect(promise).rejects.toThrow('un-mocked fetchWrapper() request')
  }

  async testDefaultMockResp () {
    const mockedFetch = this.fetchMock
    mockedFetch.mockResp()
    const resp = await fetchWrapper({ url: '/testDefaultMockResp' })
    expect(resp.status).toBe(200)
    expect(await resp.text()).toBe('')
  }

  async testRealAPICallToTheInternet () {
    const mockedFetch = this.fetchMock
    // can tell the mock to allow a real request to the Internet (probably not
    // a good testing strategy, but it is supported)
    mockedFetch.mockRespWithCallback(cb => true)
    const resp = await fetchWrapper({ method: 'GET', url: 'https://www.google.com/' })
    const respData = await resp.text()
    expect(resp.status).toBe(200)
    expect(respData).toMatch(/<html/)
  }

  async testMockValueFromCallback () {
    const mockedFetch = this.fetchMock
    let numCalls = 0
    // test subsequent calls giving different responses
    mockedFetch.mockRespWithCallback(cb => {
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
      throw new Error('this test should not call the mock  more than 5 times')
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
  }
}

runTests(MockFetchTest)
