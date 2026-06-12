import { Writable } from 'stream'

const mockExec = jest.fn()
const mockWarning = jest.fn()
const mockDebug = jest.fn()

jest.mock('@kubernetes/client-node', () => {
  return {
    KubeConfig: jest.fn().mockImplementation(() => ({
      loadFromDefault: jest.fn(),
      makeApiClient: jest.fn().mockReturnValue({}),
      getContexts: jest.fn().mockReturnValue([{ namespace: 'test-namespace' }])
    })),
    Exec: jest.fn().mockImplementation(() => ({ exec: mockExec })),
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    CoreV1Api: class CoreV1Api {},
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    BatchV1Api: class BatchV1Api {},
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    AuthorizationV1Api: class AuthorizationV1Api {},
    Log: jest.fn()
  }
})

// Single shared "current writer" the prod code receives from tar.extract.
// Each test replaces it before invoking execCpFromPod.
let currentWriter: Writable | null = null

jest.mock('tar-fs', () => ({
  default: {
    pack: jest.fn().mockReturnValue({ pipe: jest.fn() }),
    extract: jest.fn().mockImplementation(() => {
      if (!currentWriter) {
        throw new Error('test forgot to assign currentWriter before extract()')
      }
      return currentWriter
    })
  },
  __esModule: true
}))

jest.mock('../src/k8s/utils', () => {
  const actual = jest.requireActual('../src/k8s/utils')
  return {
    ...actual,
    sleep: jest.fn().mockResolvedValue(undefined)
  }
})

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: (...args: unknown[]) => mockWarning(...args),
  debug: (...args: unknown[]) => mockDebug(...args),
  error: jest.fn()
}))

import { execCpFromPod } from '../src/k8s'
import { ENV_TAR_DRAIN_TIMEOUT_MS } from '../src/k8s/utils'

// Drive the kc Exec callback once: optionally write some stderr bytes, then
// invoke the status callback so the prod settle promise resolves/rejects.
function mockExecOnceWithStatus(
  statusValue: { status: string | undefined },
  opts: {
    stderrWrite?: Buffer
    // If provided, called after statusCb so the test can simulate "data is
    // still landing on writerStream after kc reported Success". Awaited so
    // the writer can finish (or hang) before the test continues.
    afterStatus?: () => Promise<void>
  } = {}
): void {
  mockExec.mockImplementationOnce(
    async (
      _ns: string,
      _pod: string,
      _container: string,
      _command: string[],
      _stdout: NodeJS.WritableStream | null,
      stderr: NodeJS.WritableStream,
      _stdin: NodeJS.ReadableStream | null,
      _tty: boolean,
      statusCb: (s: { status: string | undefined }) => void
    ) => {
      if (opts.stderrWrite) {
        ;(stderr as unknown as { write: (b: Buffer) => void }).write(
          opts.stderrWrite
        )
      }
      statusCb(statusValue)
      if (opts.afterStatus) {
        await opts.afterStatus()
      }
      return { on: jest.fn() }
    }
  )
}

// Stub out the hash-verification loop's exec calls so the test only exercises
// the tar settle + drain path. The verification loop calls exec via
// execCalculateOutputHashSorted (a fresh `new k8s.Exec(kc)` per attempt).
// All those calls land on the same mockExec; queueing the same response for
// each verification attempt keeps the loop deterministic.
function stubVerificationLoop(): void {
  for (let i = 0; i < 32; i++) {
    mockExec.mockImplementationOnce(
      async (
        _ns: string,
        _pod: string,
        _container: string,
        _command: string[],
        stdout: NodeJS.WritableStream | null,
        _stderr: NodeJS.WritableStream,
        _stdin: NodeJS.ReadableStream | null,
        _tty: boolean,
        statusCb: (s: { status: string }) => void
      ) => {
        if (stdout) {
          ;(stdout as unknown as { write: (b: Buffer) => void }).write(
            Buffer.from('')
          )
        }
        statusCb({ status: 'Success' })
        return { on: jest.fn() }
      }
    )
  }
}

describe('execCpFromPod tar drain', () => {
  const originalDrainEnv = process.env[ENV_TAR_DRAIN_TIMEOUT_MS]

  beforeEach(() => {
    jest.clearAllMocks()
    mockExec.mockReset()
    mockWarning.mockReset()
    mockDebug.mockReset()
    currentWriter = null
    process.env['ACTIONS_RUNNER_KUBERNETES_NAMESPACE'] = 'test-namespace'
  })

  afterEach(() => {
    delete process.env['ACTIONS_RUNNER_KUBERNETES_NAMESPACE']
    if (originalDrainEnv === undefined) {
      delete process.env[ENV_TAR_DRAIN_TIMEOUT_MS]
    } else {
      process.env[ENV_TAR_DRAIN_TIMEOUT_MS] = originalDrainEnv
    }
  })

  it('awaits writer drain on Success: late writer end is honored, no warning', async () => {
    // Use a plain Writable so stream.finished resolves on `end()` without
    // needing a downstream reader. A PassThrough would buffer forever
    // because nothing pipes its readable side.
    const writer = new Writable({
      write(_chunk, _enc, cb) {
        cb()
      }
    })
    currentWriter = writer

    process.env[ENV_TAR_DRAIN_TIMEOUT_MS] = '5000'

    mockExecOnceWithStatus(
      { status: 'Success' },
      {
        // Simulate tar bytes still landing AFTER kc reports Success, then a
        // graceful end. The drain await must observe this end.
        afterStatus: async () => {
          await new Promise(r => setTimeout(r, 30))
          writer.write(Buffer.from('late tar bytes'))
          writer.end()
        }
      }
    )
    // Verification-loop stubs MUST be queued AFTER the tar exec stub —
    // mockImplementationOnce is FIFO.
    stubVerificationLoop()

    await expect(
      execCpFromPod('my-pod', '/workspace/output', '/tmp/dst')
    ).resolves.toBeUndefined()

    // Drain completed cleanly — the timeout warning MUST NOT fire.
    const warnMessages = mockWarning.mock.calls.map(c => String(c[0]))
    expect(
      warnMessages.some(m => m.includes('tar drain did not complete'))
    ).toBe(false)
  })

  it('Success + writer that never ends: timeout fires, warning emitted, writer destroyed, promise resolves', async () => {
    const writer = new Writable({
      write(_chunk, _enc, cb) {
        cb()
      }
    })
    currentWriter = writer

    // Small timeout so the test does not slow the suite. The drain bound
    // must be measured in real time (AbortSignal.timeout), so a tiny value
    // is the only way to keep this test fast.
    process.env[ENV_TAR_DRAIN_TIMEOUT_MS] = '50'

    const destroySpy = jest.spyOn(writer, 'destroy')

    mockExecOnceWithStatus({ status: 'Success' })
    // Deliberately do NOT call writer.end(). The drain await will trip the
    // 50ms AbortSignal timeout.
    // Verification stubs come AFTER the tar exec stub (FIFO).
    stubVerificationLoop()

    await expect(
      execCpFromPod('my-pod', '/workspace/output', '/tmp/dst')
    ).resolves.toBeUndefined()

    const warnMessages = mockWarning.mock.calls.map(c => String(c[0]))
    expect(
      warnMessages.some(m =>
        m.includes('tar drain did not complete within 50ms')
      )
    ).toBe(true)
    expect(destroySpy).toHaveBeenCalled()
  })

  it('Failure status: writer is destroyed immediately, no drain await', async () => {
    const writer = new Writable({
      write(_chunk, _enc, cb) {
        cb()
      }
    })
    currentWriter = writer

    process.env[ENV_TAR_DRAIN_TIMEOUT_MS] = '60000'
    const destroySpy = jest.spyOn(writer, 'destroy')

    // Upstream's settle logic only rejects when errStream is non-empty; a
    // bare Failure status with no stderr resolves. Force the reject path
    // by writing stderr on every attempt. execCpFromPod retries 30 times,
    // each attempt creating a fresh writer via tar.extract — currentWriter
    // is reused across attempts which is fine for the destroy assertion.
    for (let i = 0; i < 30; i++) {
      mockExecOnceWithStatus(
        { status: 'Failure' },
        { stderrWrite: Buffer.from('tar: cannot open: Permission denied') }
      )
    }

    await expect(
      execCpFromPod('my-pod', '/workspace/output', '/tmp/dst')
    ).rejects.toThrow()

    // Writer was destroyed on the failure path — at least once per attempt.
    expect(destroySpy).toHaveBeenCalled()
    // Critically: the drain timeout warning must NOT fire on the failure
    // path. Failure path skips the drain entirely.
    const warnMessages = mockWarning.mock.calls.map(c => String(c[0]))
    expect(
      warnMessages.some(m => m.includes('tar drain did not complete'))
    ).toBe(false)
  })
})
