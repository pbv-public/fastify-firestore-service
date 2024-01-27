export function makePinoLoggerOptions (customizeOpts) {
  function serializeReq (req) {
    const q = req.query
    const path = req.routeConfig.url
    // istanbul ignore else
    if (req.raw) {
      req = req.raw
    }
    return {
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
      res: res => ({ status: res.statusCode })
    }
  })
  return options
}
