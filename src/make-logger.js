export function makePinoLoggerOptions (customizeOpts) {
  function serializeReq (req) {
    const q = req.query
    // istanbul ignore else
    if (req.raw) {
      req = req.raw
    }
    const path = req.path
    return {
      app: req.headers['x-app'] || '',
      uid: req.headers['x-uid'] || '',
      method: req.method,
      ua: req.headers['user-agent'] || '',
      path,
      q
    }
  }
  customizeOpts = customizeOpts ?? (x => x)
  const options = customizeOpts({
    base: null, // omit pino default fields like pid and hostname
    level: 'debug',
    serializers: {
      req: serializeReq,
      res: res => {
        return { status: res.statusCode, req: serializeReq(res.request) }
      }
    }
  })
  return options
}
