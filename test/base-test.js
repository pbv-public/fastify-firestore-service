import querystring from 'node:querystring'
import zlib from 'node:zlib'

import { jest } from '@jest/globals'
import { BaseTest, runTests } from '@pbvision/jest-unit-test'
import superagentDefaults from 'superagent-defaults'
import supertest from 'supertest'

import fetchWrapper from '../src/fetch-wrapper.js'

let FASTIFY_CACHE

beforeAll(() => {
  fetchWrapper.__mock = mockNodeFetch()
})

afterAll(async () => {
  await FASTIFY_CACHE?.close()
  FASTIFY_CACHE = undefined
})

class BaseAppTest extends BaseTest {
  async getMakeServiceFunc () {
    const { default: func } = await import('../src/app.js')
    return func
  }

  beforeEach () {
    this.fetchMock = fetchWrapper.__mock
    fetchWrapper.__mock.mockClear()

    // default response is a weird error to help make it obvious the unit test
    // author forgot to provide a custom mock value
    this.fetchMock.mockResp('custom mock value not set', 555)
  }

  async beforeAll () {
    const makeService = await this.getMakeServiceFunc()
    this.fastify = FASTIFY_CACHE ?? await makeService()
    FASTIFY_CACHE = this.fastify

    await Promise.all([super.beforeAll(), this.fastify.ready()])

    /**
     * Avoid having to consider compression in unit tests
     * by removing the `accept-encoding` header,
     * which is added by default from SuperTest
     */
    const superTest = superagentDefaults(supertest(this.fastify.server))
    superTest.set('accept-encoding', null)
    this.app = new Proxy(superTest, {
      get: (target, prop, receiver) => {
        if (['get', 'post', 'put', 'delete'].includes(prop)) {
          return (...requestParams) => {
            const test = target[prop](...requestParams)
            const originalExpect = test.expect
            test.expect = async (...expectParams) => {
              console.log('  \u2502 Expecting', expectParams[0])
              return originalExpect.call(test, ...expectParams)
            }
            return test
          }
        } else {
          return target[prop]
        }
      }
    })
  }
}

function makeHeadersObj (headers) {
  return {
    get: name => headers[name]
  }
}

// the promise input conveniently matches the promise produced by supertest
// so you can pass the output of app.post(), etc. as the promise here as is
function makeNodeFetchMockValueFromPromise (promise) {
  const mockValue = new Promise(resolve => {
    promise.then(httpResponse => {
      let body = httpResponse.text || httpResponse.body || ''
      const headers = {}
      if (typeof body !== 'string') {
        body = JSON.stringify(body)
        headers['content-type'] = 'application/json'
      }
      resolve({
        status: httpResponse.status || 200,
        headers: makeHeadersObj(headers),
        text: async () => body
      })
    })
  })
  return mockValue
}

function makeNodeFetchMockValue (body, status, callback) {
  const mockValue = new Promise(resolve => {
    // setTimeout is used so that this promise does not synchronously resolve
    // because unmocked fetch will NEVER return synchronously. This ensures
    // functions which call fetch() never resolve synchronously (which can
    // change their behavior... e.g., allow them to throw when called,
    // instead of only rejecting later when await'ed).
    // https://github.com/facebook/jest/issues/6028 (since jest 21.x)
    setTimeout(() => {
      const headers = {}
      resolve({
        status,
        headers: makeHeadersObj(headers),
        text: async () => {
          if (callback) {
            callback()
          }
          if (typeof body === 'string') {
            return body
          }
          headers['content-type'] = 'application/json'
          return JSON.stringify(body)
        }
      })
    }, 0)
  })
  return mockValue
}

function mockNodeFetch () {
  const nodeFetchMock = jest.fn().mockImplementation()

  nodeFetchMock.mockResp = (body = '', statusCode = 200, callback) => {
    nodeFetchMock.mockReturnValue(makeNodeFetchMockValue(body, statusCode, callback))
  }

  /**
   * Determine the mock response to use when the request is made.
   *
   * @param  {...function (request)} callbacks a list of callbacks in the order
   *   to check and see if they have a mock response to use; if no callback,
   *   provides a mock response then an error will be thrown
   */
  nodeFetchMock.mockRespWithCallback = (...callbacks) => {
    nodeFetchMock.mockImplementation((fullURL, options) => {
      // construct the fetchWrapper's request parameter from the fullURL and
      // options passed as parameters to node-fetch
      const [baseUrl, qsParams] = fullURL.split('?', 2)
      const request = {
        compress: options.headers['content-encoding'] === 'br',
        method: options.method,
        url: baseUrl,
        qsParams: querystring.parse(qsParams),
        headers: options.headers
      }
      delete request.headers['content-encoding']
      const body = options.body
        ? (request.compress ? options.body : zlib.brotliDecompressSync(options.body))
        : options.body
      if (options.headers['content-type'] === 'application/json') {
        delete options.headers['content-type']
        request.json = JSON.parse(body)
      } else {
        request.body = body // may be undefined
      }

      for (const callback of callbacks) {
        const desiredHTTPResponse = callback(request)
        if (desiredHTTPResponse === true) {
          return fetchWrapper(request, false)
        }
        if (desiredHTTPResponse) {
          if (desiredHTTPResponse.then) {
            return makeNodeFetchMockValueFromPromise(desiredHTTPResponse)
          }
          return makeNodeFetchMockValue(
            // follows the names from supertest
            desiredHTTPResponse.text || desiredHTTPResponse.body || '',
            desiredHTTPResponse.status || 200)
        }
      }
      throw new Error(`un-mocked fetchWrapper() request: ${JSON.stringify(request)}`)
    })
  }

  // will respond to the next N requests with the specified N responses
  nodeFetchMock.mockRespMulti = (...responses) => {
    let idx = 0
    function setupNextResponse () {
      if (idx < responses.length) {
        const [body, code] = responses[idx]
        nodeFetchMock.mockResp(body ?? '', code ?? 200, setupNextResponse)
      } else {
        // exactly equal means we just got our last callback (okay)
        nodeFetchMock.mockResp('ran out of mocked responses', 556)
      }
      idx += 1
    }
    setupNextResponse()
  }
  return nodeFetchMock
}

export {
  BaseAppTest,
  BaseTest,
  runTests
}
