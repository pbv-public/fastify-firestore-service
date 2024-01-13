import querystring from 'node:querystring'
import zlib from 'node:zlib'

import realFetch from 'node-fetch'

async function fetchWrapper (options, mockedFetch) {
  const { compress = true, method = 'POST', url, qsParams, json } = options
  let { body, headers } = options
  headers = { ...headers } // copy the headers before we change them

  // compress the body using brotli
  if (json) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(options.json)
  }
  if (body && compress) {
    body = zlib.brotliCompressSync(body)
    headers['content-encoding'] = 'br'
  }

  // istanbul ignore next
  const fetch = mockedFetch ?? fetchWrapper.__mock ?? realFetch

  // compute the full URL including search params
  let fullURL = url
  if (qsParams) {
    const qsStr = querystring.stringify(qsParams)
    if (qsStr) {
      fullURL += `?${qsStr}`
    }
  }
  return fetch(fullURL, { body, headers, method, compress: false })
}

export default fetchWrapper
