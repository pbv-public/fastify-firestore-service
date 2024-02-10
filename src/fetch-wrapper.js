import querystring from 'node:querystring'

import realFetch from 'node-fetch'

async function fetchWrapper (request, mockedFetch) {
  const { compress = true, method = 'POST', url, qsParams, json } = request
  let { body, headers } = request
  headers = { ...headers } // copy the headers before we change them

  if (json) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(request.json)
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
  const options = { body, headers, method, compress }
  return fetch(fullURL, options)
}

export default fetchWrapper
