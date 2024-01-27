import querystring from 'node:querystring'
import zlib from 'node:zlib'

import realFetch from 'node-fetch'

async function fetchWrapper (request, mockedFetch) {
  const { compress = true, method = 'POST', url, qsParams, json } = request
  let { body, headers } = request
  headers = { ...headers } // copy the headers before we change them

  // compress the body using brotli
  if (json) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(request.json)
  }
  if (body && compress) {
    body = zlib.brotliCompressSync(body)
    headers['content-encoding'] = 'br'
  }

  const fetch = (mockedFetch === false)
    ? realFetch
    : (mockedFetch ?? fetchWrapper.__mock ?? realFetch)

  // compute the full URL including search params
  let fullURL = url
  if (qsParams) {
    const qsStr = querystring.stringify(qsParams)
    if (qsStr) {
      fullURL += `?${qsStr}`
    }
  }
  const options = { body, headers, method, compress: false }
  return fetch(fullURL, options)
}

export default fetchWrapper
