import { BackOffManager } from '../src/k8s/backoff'

describe('BackOffManager', () => {
  const originalEnv = process.env
  let setTimeoutSpy: jest.SpyInstance

  beforeEach(() => {
    jest.useFakeTimers()
    process.env = { ...originalEnv }
    delete process.env.ACTIONS_RUNNER_BACKOFF_INITIAL_MS
    delete process.env.ACTIONS_RUNNER_BACKOFF_MAX_MS
    setTimeoutSpy = jest.spyOn(global, 'setTimeout')
  })

  afterEach(() => {
    setTimeoutSpy.mockRestore()
    jest.useRealTimers()
    process.env = originalEnv
  })

  // Runs `count` back-offs and returns the delay each one slept for.
  async function delays(
    manager: BackOffManager,
    count: number
  ): Promise<number[]> {
    for (let i = 0; i < count; i++) {
      const pending = manager.backOff()
      await jest.runAllTimersAsync()
      await pending
    }
    return setTimeoutSpy.mock.calls.map(call => call[1] as number)
  }

  it('doubles from 1 s and caps at 20 s by default', async () => {
    const manager = new BackOffManager()
    expect(await delays(manager, 7)).toEqual([
      1000, 2000, 4000, 8000, 16000, 20000, 20000
    ])
  })

  it('reads both bounds from the environment', async () => {
    process.env.ACTIONS_RUNNER_BACKOFF_INITIAL_MS = '250'
    process.env.ACTIONS_RUNNER_BACKOFF_MAX_MS = '1000'
    const manager = new BackOffManager()
    expect(await delays(manager, 4)).toEqual([250, 500, 1000, 1000])
  })

  it('never waits less than the initial value when the maximum is lower', async () => {
    process.env.ACTIONS_RUNNER_BACKOFF_INITIAL_MS = '5000'
    process.env.ACTIONS_RUNNER_BACKOFF_MAX_MS = '1000'
    const manager = new BackOffManager()
    expect(await delays(manager, 2)).toEqual([5000, 5000])
  })

  it('falls back to the defaults for values that are not positive integers', async () => {
    process.env.ACTIONS_RUNNER_BACKOFF_INITIAL_MS = 'fast'
    process.env.ACTIONS_RUNNER_BACKOFF_MAX_MS = '0'
    const manager = new BackOffManager()
    expect(await delays(manager, 2)).toEqual([1000, 2000])
  })

  it('accounts the configured delays against throwAfterSeconds', async () => {
    process.env.ACTIONS_RUNNER_BACKOFF_INITIAL_MS = '500'
    process.env.ACTIONS_RUNNER_BACKOFF_MAX_MS = '500'
    const manager = new BackOffManager(1)
    // 0.5 s, 1.0 s: neither exceeds the limit. The third back-off does.
    await delays(manager, 2)
    // The handler is attached before the timers run, so the rejection is
    // never unhandled while the fake clock advances.
    const third = expect(manager.backOff()).rejects.toThrow('backoff timeout')
    await jest.runAllTimersAsync()
    await third
    expect(manager.totalTime).toBeCloseTo(1.5)
  })
})
