const mockExec = jest.fn()
const mockReadNamespacedPod = jest.fn()
const mockReadNamespacedJob = jest.fn()

jest.mock('@actions/core', () => ({
  debug: jest.fn(),
  warning: jest.fn(),
  error: jest.fn()
}))

jest.mock('@kubernetes/client-node', () => {
  return {
    KubeConfig: jest.fn().mockImplementation(() => ({
      loadFromDefault: jest.fn(),
      makeApiClient: jest.fn().mockImplementation(ApiClass => {
        const name = ApiClass?.name || ApiClass?.toString() || ''
        if (name.includes('Batch')) {
          return { readNamespacedJob: mockReadNamespacedJob }
        }
        if (name.includes('Authorization')) {
          return { createSelfSubjectAccessReview: jest.fn() }
        }
        return { readNamespacedPod: mockReadNamespacedPod }
      }),
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
    extract: jest.fn()
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

import {
  execCpToPod,
  execCpFromPod,
  waitForJobToComplete,
  waitForPodPhases
} from '../src/k8s'
import { PodPhase } from '../src/k8s/utils'
import { Writable } from 'stream'
import tar from 'tar-fs'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

describe('error serialization', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(tar.extract).mockImplementation(
      () =>
        new Writable({
          write(_chunk, _encoding, callback) {
            callback()
          }
        })
    )
    process.env['ACTIONS_RUNNER_KUBERNETES_NAMESPACE'] = 'test-namespace'
  })

  afterEach(() => {
    delete process.env['ACTIONS_RUNNER_KUBERNETES_NAMESPACE']
  })

  describe('execCpToPod', () => {
    it('should include Error.message in thrown error after retries', async () => {
      mockExec.mockRejectedValue(new Error('connection refused'))

      await expect(
        execCpToPod('test-pod', '/tmp/src', '/workspace')
      ).rejects.toThrow('cpToPod failed after 30 attempts: connection refused')
    })

    it('should use String() for non-Error throwables', async () => {
      mockExec.mockRejectedValue('raw string error')

      await expect(
        execCpToPod('test-pod', '/tmp/src', '/workspace')
      ).rejects.toThrow('cpToPod failed after 30 attempts: raw string error')
    })

    it('should not produce empty braces in error message', async () => {
      mockExec.mockRejectedValue(new Error('ETIMEOUT'))

      await expect(
        execCpToPod('test-pod', '/tmp/src', '/workspace')
      ).rejects.toMatchObject({
        message: expect.not.stringContaining('{}')
      })
    })
  })

  describe('execCpFromPod', () => {
    it('fully extracts real workspace files before returning', async () => {
      const actualTar = jest.requireActual<typeof tar>('tar-fs')
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'novolume-archive-'))
      const source = path.join(root, 'source')
      const destination = path.join(root, 'destination')
      const actionPath = path.join('output', 'composite')
      try {
        fs.mkdirSync(path.join(source, actionPath), { recursive: true })
        fs.mkdirSync(destination)
        const content = 'runs:\n  using: composite\n'
        fs.writeFileSync(path.join(source, actionPath, 'action.yaml'), content)
        fs.writeFileSync(
          path.join(source, actionPath, 'goodbye.sh'),
          '#!/bin/sh\necho goodbye\n',
          { mode: 0o755 }
        )
        fs.symlinkSync(
          'action.yaml',
          path.join(source, actionPath, 'manifest-link')
        )
        jest.mocked(tar.extract).mockImplementation(actualTar.extract)
        mockExec.mockImplementation(
          async (
            _namespace,
            _pod,
            _container,
            _command,
            stdout,
            _stderr,
            _stdin,
            _tty,
            status
          ) => {
            actualTar
              .pack(source)
              .on('error', error => stdout.destroy(error))
              .on('end', () => status({ status: 'Success' }))
              .pipe(stdout)
            return { close: jest.fn() }
          }
        )

        await execCpFromPod('test-pod', '/workspace/output', destination)

        expect(
          fs.readFileSync(
            path.join(destination, actionPath, 'action.yaml'),
            'utf8'
          )
        ).toBe(content)
        expect(
          fs.statSync(path.join(destination, actionPath, 'goodbye.sh')).mode &
            0o777
        ).toBe(0o755)
        expect(
          fs.readlinkSync(path.join(destination, actionPath, 'manifest-link'))
        ).toBe('action.yaml')
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('waits for extraction to finish after the remote tar succeeds', async () => {
      let finishExtraction: () => void = () => {
        throw new Error('extraction has not started')
      }
      const extractionStarted = new Promise<void>(resolve => {
        jest.mocked(tar.extract).mockImplementation(
          () =>
            new Writable({
              final(callback) {
                finishExtraction = callback
                resolve()
              }
            })
        )
      })
      const close = jest.fn()
      mockExec.mockImplementation(
        async (
          _namespace,
          _pod,
          _container,
          _command,
          stdout,
          _stderr,
          _stdin,
          _tty,
          status
        ) => {
          stdout.end()
          status({ status: 'Success' })
          return Promise.resolve({ close })
        }
      )
      let completed = false
      const copying = execCpFromPod(
        'test-pod',
        '/workspace/output',
        '/tmp/dst'
      ).then(() => {
        completed = true
      })
      await extractionStarted
      await new Promise(resolve => setImmediate(resolve))
      expect(completed).toBe(false)

      finishExtraction()
      await copying
      expect(completed).toBe(true)
      expect(close).toHaveBeenCalled()
    })

    it('rejects a failed remote tar even when stderr is empty', async () => {
      mockExec.mockImplementation(
        async (
          _namespace,
          _pod,
          _container,
          _command,
          stdout,
          _stderr,
          _stdin,
          _tty,
          status
        ) => {
          stdout.end()
          status({ status: 'Failure', message: 'tar exited 2' })
          return Promise.resolve({ close: jest.fn() })
        }
      )

      await expect(
        execCpFromPod('test-pod', '/workspace/output', '/tmp/dst')
      ).rejects.toThrow('tar exited 2')
    })

    it('rejects extraction errors even when the remote tar succeeds', async () => {
      jest.mocked(tar.extract).mockImplementation(
        () =>
          new Writable({
            final(callback) {
              callback(new Error('incomplete archive'))
            }
          })
      )
      mockExec.mockImplementation(
        async (
          _namespace,
          _pod,
          _container,
          _command,
          stdout,
          _stderr,
          _stdin,
          _tty,
          status
        ) => {
          stdout.end()
          status({ status: 'Success' })
          return Promise.resolve({ close: jest.fn() })
        }
      )

      await expect(
        execCpFromPod('test-pod', '/workspace/output', '/tmp/dst')
      ).rejects.toThrow('incomplete archive')
    })

    it('should include Error.message in thrown error after retries', async () => {
      mockExec.mockRejectedValue(new Error('container not found'))

      await expect(
        execCpFromPod('test-pod', '/workspace/output', '/tmp/dst')
      ).rejects.toThrow(
        'execCpFromPod failed after 30 attempts: container not found'
      )
    })

    it('should use String() for non-Error throwables', async () => {
      mockExec.mockRejectedValue(42)

      await expect(
        execCpFromPod('test-pod', '/workspace/output', '/tmp/dst')
      ).rejects.toThrow('execCpFromPod failed after 30 attempts: 42')
    })
  })

  describe('waitForJobToComplete', () => {
    it('should include Error.message when job fails', async () => {
      mockReadNamespacedJob.mockResolvedValue({
        status: { failed: 1 }
      })

      await expect(waitForJobToComplete('my-job')).rejects.toThrow(
        'job my-job has failed: job my-job has failed'
      )
    })

    it('should include Error.message when API call throws', async () => {
      mockReadNamespacedJob.mockRejectedValue(new Error('403 Forbidden'))

      await expect(waitForJobToComplete('my-job')).rejects.toThrow(
        'job my-job has failed: 403 Forbidden'
      )
    })

    it('should use String() for non-Error throwables from API', async () => {
      mockReadNamespacedJob.mockRejectedValue('unexpected API failure')

      await expect(waitForJobToComplete('my-job')).rejects.toThrow(
        'job my-job has failed: unexpected API failure'
      )
    })
  })

  describe('waitForPodPhases', () => {
    it('should include error message when pod enters unhealthy phase', async () => {
      mockReadNamespacedPod.mockResolvedValue({
        status: { phase: 'Failed' }
      })

      await expect(
        waitForPodPhases(
          'test-pod',
          new Set([PodPhase.RUNNING]),
          new Set([PodPhase.PENDING])
        )
      ).rejects.toThrow(/Pod test-pod is unhealthy with phase status Failed/)
    })

    it('should include Error.message when API call throws', async () => {
      mockReadNamespacedPod.mockRejectedValue(new Error('network timeout'))

      await expect(
        waitForPodPhases(
          'test-pod',
          new Set([PodPhase.RUNNING]),
          new Set([PodPhase.PENDING])
        )
      ).rejects.toThrow(
        'Pod test-pod is unhealthy with phase status Unknown: network timeout'
      )
    })

    it('should not produce empty braces from Error objects', async () => {
      mockReadNamespacedPod.mockRejectedValue(new Error('socket hang up'))

      try {
        await waitForPodPhases(
          'test-pod',
          new Set([PodPhase.RUNNING]),
          new Set([PodPhase.PENDING])
        )
        fail('Expected waitForPodPhases to throw')
      } catch (error) {
        const msg = (error as Error).message
        expect(msg).not.toContain('{}')
        expect(msg).toContain('socket hang up')
      }
    })
  })
})
