import { formatError } from '../src/k8s/utils'

describe('formatError', () => {
  it('returns the message of a standard Error (or stack when available)', () => {
    const err = new Error('connection refused')
    const out = formatError(err)
    // err.stack starts with 'Error: connection refused' in V8; either form is fine.
    expect(out).toContain('connection refused')
  })

  it('extracts response.body.message from @kubernetes/client-node errors', () => {
    const k8sErr = {
      message: 'HTTP request failed',
      response: {
        body: {
          message: "pods 'foo' is forbidden: User cannot create pods",
          reason: 'Forbidden',
          code: 403
        }
      }
    }
    expect(formatError(k8sErr)).toBe(
      "pods 'foo' is forbidden: User cannot create pods (reason: Forbidden)"
    )
  })

  it('returns body.message without reason when reason is missing', () => {
    const k8sErr = {
      response: { body: { message: 'something broke' } }
    }
    expect(formatError(k8sErr)).toBe('something broke')
  })

  it('falls back to top-level body when response is absent', () => {
    const k8sErr = { body: { message: 'top-level body message' } }
    expect(formatError(k8sErr)).toBe('top-level body message')
  })

  it('does NOT throw on objects with circular references (the #329 regression)', () => {
    // Reproduce the @kubernetes/client-node error shape that crashed
    // JSON.stringify with: "Converting circular structure to JSON,
    // starting at object with constructor 'TLSSocket'".
    const socket: any = { constructor: { name: 'TLSSocket' } }
    const parser: any = { constructor: { name: 'HTTPParser' }, socket }
    socket.parser = parser
    const circularErr: any = {
      message: 'k8s exec failed',
      response: { req: { socket } }
      // no response.body — exercises the Error/JSON.stringify fallbacks
    }

    expect(() => formatError(circularErr)).not.toThrow()
    expect(typeof formatError(circularErr)).toBe('string')
  })

  it('returns the message field when present on a plain object', () => {
    // Many K8s client errors carry a top-level message even without body.
    const err = new Error('top-level msg only')
    expect(formatError(err)).toContain('top-level msg only')
  })

  it('handles string throwables', () => {
    expect(formatError('raw string error')).toBe('raw string error')
  })

  it('handles number throwables', () => {
    expect(formatError(42)).toBe('42')
  })

  it('handles null', () => {
    expect(formatError(null)).toBe('null')
  })

  it('handles undefined', () => {
    expect(formatError(undefined)).toBe('undefined')
  })

  it('handles plain objects without message via JSON.stringify', () => {
    expect(formatError({ code: 'ENOENT', path: '/tmp/x' })).toBe(
      '{"code":"ENOENT","path":"/tmp/x"}'
    )
  })

  it('falls back to String() when even JSON.stringify throws', () => {
    // Construct an object whose toJSON throws — exercises the inner try/catch.
    const evil = {
      toJSON() {
        throw new Error('toJSON exploded')
      }
    }
    expect(() => formatError(evil)).not.toThrow()
    expect(formatError(evil)).toBe('[object Object]')
  })
})
