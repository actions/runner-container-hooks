import { EventEmitter } from 'events'
import { parsePositiveMsEnv, WebSocketHeartbeat } from '../src/k8s/heartbeat'
import type { HeartbeatWebSocket } from '../src/k8s/heartbeat'

jest.mock('@actions/core', () => ({
  debug: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  info: jest.fn()
}))

// Minimal WebSocket test double backed by EventEmitter
class MockWebSocket extends EventEmitter implements HeartbeatWebSocket {
  readyState: number
  ping = jest.fn()
  close = jest.fn()

  constructor(readyState = 1) {
    super()
    this.readyState = readyState
  }
}

describe('parsePositiveMsEnv', () => {
  it('returns the fallback for undefined input', () => {
    expect(parsePositiveMsEnv(undefined, 5000)).toBe(5000)
  })

  it('returns the fallback for an empty string', () => {
    expect(parsePositiveMsEnv('', 5000)).toBe(5000)
  })

  it('returns the fallback for non-numeric input', () => {
    expect(parsePositiveMsEnv('abc', 5000)).toBe(5000)
  })

  it('returns the fallback for zero', () => {
    expect(parsePositiveMsEnv('0', 5000)).toBe(5000)
  })

  it('returns the fallback for negative values', () => {
    expect(parsePositiveMsEnv('-100', 5000)).toBe(5000)
  })

  it('returns the fallback for NaN', () => {
    expect(parsePositiveMsEnv('NaN', 5000)).toBe(5000)
  })

  it('parses a valid positive integer', () => {
    expect(parsePositiveMsEnv('3000', 5000)).toBe(3000)
  })

  it('ignores fractional parts (parseInt semantics)', () => {
    expect(parsePositiveMsEnv('1500.9', 5000)).toBe(1500)
  })
})

describe('WebSocketHeartbeat', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('CONNECTING state (readyState === 0)', () => {
    it('skips ping while connecting but keeps the interval running', () => {
      const ws = new MockWebSocket(0) // CONNECTING
      const reject = jest.fn()
      const hb = new WebSocketHeartbeat(100, 10000)

      hb.start(ws, reject)

      jest.advanceTimersByTime(500) // fire interval several times

      expect(ws.ping).not.toHaveBeenCalled()
      expect(reject).not.toHaveBeenCalled()

      hb.stop()
    })

    it('starts sending pings once the socket transitions to OPEN', () => {
      const ws = new MockWebSocket(0)
      const reject = jest.fn()
      const hb = new WebSocketHeartbeat(100, 10000)

      hb.start(ws, reject)

      jest.advanceTimersByTime(100) // one interval tick while CONNECTING
      expect(ws.ping).not.toHaveBeenCalled()

      ws.readyState = 1 // now OPEN
      jest.advanceTimersByTime(100) // exactly one more tick

      expect(ws.ping).toHaveBeenCalledTimes(1)

      hb.stop()
    })
  })

  describe('pong timeout', () => {
    it('closes the socket and rejects the promise when no pong is received', () => {
      const ws = new MockWebSocket(1)
      const reject = jest.fn()
      const hb = new WebSocketHeartbeat(100, 500)

      hb.start(ws, reject)

      jest.advanceTimersByTime(600) // exceed pong deadline

      expect(ws.close).toHaveBeenCalledTimes(1)
      expect(reject).toHaveBeenCalledTimes(1)
      expect(reject.mock.calls[0][0]).toBeInstanceOf(Error)
      expect(reject.mock.calls[0][0].message).toMatch(/heartbeat timeout/)
    })

    it('resets the pong deadline when a pong is received', () => {
      const ws = new MockWebSocket(1)
      const reject = jest.fn()
      const hb = new WebSocketHeartbeat(100, 500)

      hb.start(ws, reject)

      jest.advanceTimersByTime(400) // close to deadline but not past it
      ws.emit('pong') // pong received — should reset the clock

      jest.advanceTimersByTime(400) // would have timed out without the reset

      expect(reject).not.toHaveBeenCalled()

      hb.stop()
    })
  })

  describe('stop()', () => {
    it('clears all timers so no pings or timeout callbacks fire after stop', () => {
      const ws = new MockWebSocket(1)
      const reject = jest.fn()
      const hb = new WebSocketHeartbeat(100, 500)

      hb.start(ws, reject)

      jest.advanceTimersByTime(50)
      hb.stop()

      const pingCountAtStop = (ws.ping as jest.Mock).mock.calls.length

      jest.advanceTimersByTime(1000) // well past both intervals

      expect(ws.ping).toHaveBeenCalledTimes(pingCountAtStop)
      expect(reject).not.toHaveBeenCalled()
    })

    it('stops automatically when the WebSocket emits close', () => {
      const ws = new MockWebSocket(1)
      const reject = jest.fn()
      const hb = new WebSocketHeartbeat(100, 500)

      hb.start(ws, reject)

      ws.emit('close')

      jest.advanceTimersByTime(1000)

      expect(reject).not.toHaveBeenCalled()
    })
  })

  describe('CLOSING/CLOSED state', () => {
    it('stops the heartbeat when readyState is CLOSING (2)', () => {
      const ws = new MockWebSocket(1)
      const reject = jest.fn()
      const hb = new WebSocketHeartbeat(100, 10000)

      hb.start(ws, reject)

      jest.advanceTimersByTime(150) // one successful ping
      expect(ws.ping).toHaveBeenCalledTimes(1)

      ws.readyState = 2 // CLOSING
      jest.advanceTimersByTime(200)

      // ping should not have been called again after transitioning to CLOSING
      expect(ws.ping).toHaveBeenCalledTimes(1)
    })
  })
})
