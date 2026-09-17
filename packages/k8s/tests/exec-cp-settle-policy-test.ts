const mockExec = jest.fn()

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

jest.mock('tar-fs', () => ({
  default: {
    pack: jest.fn().mockReturnValue({ pipe: jest.fn() }),
    extract: jest.fn().mockReturnValue({ on: jest.fn(), pipe: jest.fn() })
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

const mockDebug = jest.fn()
jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn(),
  debug: (...args: unknown[]) => mockDebug(...args),
  error: jest.fn()
}))

import { execCpToPod, execCpFromPod } from '../src/k8s'

// Drive the kc Exec callback synchronously after the prod code awaits it.
// The kc `exec(...)` signature is:
//   (ns, pod, container, command, stdout, stderr, stdin, tty, statusCb)
// The prod settle promise wraps that single call.
function mockExecOnceWithStatus(
  statusValue: { status: string },
  stderrWrite?: Buffer
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
      statusCb: (s: { status: string }) => void
    ) => {
      if (stderrWrite) {
        ;(stderr as unknown as { write: (b: Buffer) => void }).write(
          stderrWrite
        )
      }
      // Invoke the status callback so the prod settle promise resolves/rejects.
      statusCb(statusValue)
      return { on: jest.fn() }
    }
  )
}

describe('execCpToPod settle policy', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDebug.mockReset()
    process.env['ACTIONS_RUNNER_KUBERNETES_NAMESPACE'] = 'test-namespace'
  })

  afterEach(() => {
    delete process.env['ACTIONS_RUNNER_KUBERNETES_NAMESPACE']
  })

  it('resolves on Success even when stderr is non-empty (benign tar warning)', async () => {
    mockExecOnceWithStatus(
      { status: 'Success' },
      Buffer.from("tar: Removing leading '/' from member names\n")
    )

    // Force the post-exec hash-verification loop to no-op (we only care about
    // the settle behavior here). It retries up to 15 times and the
    // jest.mock above makes sleep() instantly resolve, so the loop exits
    // quickly even with errors.
    await expect(
      execCpToPod('my-pod', '/tmp/src', '/workspace')
    ).resolves.toBeUndefined()

    // The whole point of the fix: benign stderr on Success must NOT
    // trigger a retry. Exactly one tar-cp exec call.
    expect(mockExec).toHaveBeenCalledTimes(1)

    // Stderr must be forwarded to debug logs (not silently dropped).
    const debugMessages = mockDebug.mock.calls.map(c => String(c[0]))
    expect(debugMessages.some(m => m.includes('execCpToPod stderr'))).toBe(true)
  })

  it('rejects on Failure with stderr included in the error message', async () => {
    // Fail every attempt so the retry loop eventually throws the formatted
    // wrapper. We rely on the sleep mock resolving instantly.
    for (let i = 0; i < 30; i++) {
      mockExecOnceWithStatus(
        { status: 'Failure' },
        Buffer.from('tar: cannot open: No space left')
      )
    }

    await expect(
      execCpToPod('my-pod', '/tmp/src', '/workspace')
    ).rejects.toThrow(/status: Failure/)
    // Retry cap is 30 in execCpToPod's while loop.
    expect(mockExec).toHaveBeenCalledTimes(30)
  })

  it('rejects when V1Status.status is undefined', async () => {
    for (let i = 0; i < 30; i++) {
      mockExecOnceWithStatus({ status: undefined } as unknown as {
        status: string
      })
    }

    await expect(
      execCpToPod('my-pod', '/tmp/src', '/workspace')
    ).rejects.toThrow(/status: undefined/)
  })
})

describe('execCpFromPod settle policy', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDebug.mockReset()
    process.env['ACTIONS_RUNNER_KUBERNETES_NAMESPACE'] = 'test-namespace'
  })

  afterEach(() => {
    delete process.env['ACTIONS_RUNNER_KUBERNETES_NAMESPACE']
  })

  it('resolves on Success even when stderr is non-empty (benign tar warning)', async () => {
    mockExecOnceWithStatus(
      { status: 'Success' },
      Buffer.from("tar: Removing leading '/' from member names\n")
    )

    await expect(
      execCpFromPod('my-pod', '/workspace/output', '/tmp/dst')
    ).resolves.toBeUndefined()

    // Benign stderr on Success must NOT trigger a retry. Exactly one
    // tar-cp exec call. (The post-cp hash-verification loop also calls
    // exec via execCalculateOutputHashSorted; filter to the tar invocation
    // we care about.)
    const tarCalls = mockExec.mock.calls.filter(c =>
      Array.isArray(c[3]) && c[3].some((a: string) => a && a.includes('tar'))
    )
    expect(tarCalls).toHaveLength(1)

    const debugMessages = mockDebug.mock.calls.map(c => String(c[0]))
    expect(debugMessages.some(m => m.includes('execCpFromPod stderr'))).toBe(
      true
    )
  })

  it('rejects on Failure with stderr included in the error message', async () => {
    for (let i = 0; i < 30; i++) {
      mockExecOnceWithStatus(
        { status: 'Failure' },
        Buffer.from('tar: cannot open: Permission denied')
      )
    }

    await expect(
      execCpFromPod('my-pod', '/workspace/output', '/tmp/dst')
    ).rejects.toThrow(/status: Failure/)
    // Retry cap is 30 in execCpFromPod's while loop.
    expect(mockExec).toHaveBeenCalledTimes(30)
  })

  it('rejects when V1Status.status is undefined', async () => {
    for (let i = 0; i < 30; i++) {
      mockExecOnceWithStatus({ status: undefined } as unknown as {
        status: string
      })
    }

    await expect(
      execCpFromPod('my-pod', '/workspace/output', '/tmp/dst')
    ).rejects.toThrow(/status: undefined/)
  })
})
