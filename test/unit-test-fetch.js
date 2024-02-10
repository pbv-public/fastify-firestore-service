import { jest } from '@jest/globals'

import fetchWrapper from '../src/fetch-wrapper.js'

import { BaseTest, runTests } from './base-test.js'

// Tests to make sure new JS features introduced in node14
// are working, and context highlight, linter etc are compatible
class CompressionTest extends BaseTest {
  async testCompression () {
    const mock = jest.fn().mockImplementation((url, { body }) => {
      expect(body).toEqual('321')
    })
    await fetchWrapper({
      url: '123',
      body: '321',
      compress: true
    }, mock)
    mock.mockRestore()

    const mock2 = jest.fn().mockImplementation((url, { body }) => {
      expect(body).toEqual(JSON.stringify({
        data: '321'
      }))
    })
    await fetchWrapper({
      url: '123',
      json: {
        data: '321'
      },
      compress: true
    }, mock2)
    mock2.mockRestore()
  }

  async testNoCompression () {
    const mock = jest.fn().mockImplementation((url, { body }) => {
      expect(body).toBe('321')
    })
    await fetchWrapper({
      url: '123',
      body: '321',
      compress: false
    }, mock)
    expect(mock.mock.calls.length).toBe(1)
    expect(mock.mock.calls[0][0]).toEqual('123') // url
    expect(mock.mock.calls[0][1]).toEqual({
      compress: false,
      body: '321',
      headers: {},
      method: 'POST'
    })
    mock.mockRestore()
  }

  async testContentEncoding () {
    const mock = jest.fn().mockImplementation((url, { headers }) => {
      // will be set by node-fetch not by our call to node-fetch
      expect(headers['content-encoding']).toBe(undefined)
    })
    await fetchWrapper({
      url: '123',
      body: '321',
      compress: true
    }, mock)
    mock.mockRestore()
    jest.fn().mockImplementation((url, { headers }) => {
      expect(headers['content-encoding']).toBeUndefined()
    })
    await fetchWrapper({
      url: '123',
      compress: true
    }, mock)
    mock.mockRestore()
  }
}

runTests(CompressionTest)
