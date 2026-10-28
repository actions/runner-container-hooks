import * as core from '@actions/core'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { spawnSync } from 'child_process'
import { PrepareJobArgs, RunContainerStepArgs } from 'hooklib'
import { prepareJob } from '../src/hooks/prepare-job'
import { runContainerStep } from '../src/hooks/run-container-step'
import { JOB_CONTAINER_NAME } from '../src/hooks/constants'
import * as k8s from '../src/k8s'
import * as utils from '../src/k8s/utils'

jest.mock('../src/k8s', () => ({
  ...jest.requireActual('../src/k8s'),
  POD_VOLUME_NAME: 'work',
  createPod: jest.fn(),
  isPodContainerAlpine: jest.fn(),
  pruneJobs: jest.fn(),
  prunePods: jest.fn(),
  createJob: jest.fn(),
  createSecretForEnvs: jest.fn(),
  deleteJob: jest.fn(),
  deletePod: jest.fn(),
  getContainerJobPodName: jest.fn(),
  getPodLogs: jest.fn(),
  waitForContainerToTerminate: jest.fn(),
  waitForPodPhases: jest.fn()
}))

const originalEnv = process.env

beforeEach(() => {
  jest.resetAllMocks()
  process.env = {
    ...originalEnv,
    RUNNER_WORKSPACE: '/mnt/_work/repo',
    GITHUB_WORKSPACE: '/mnt/_work/repo/repo'
  }
  delete process.env.ACTIONS_RUNNER_PREPARE_JOB_TIMEOUT_SECONDS
  jest.spyOn(utils, 'readExtensionFromFile').mockReturnValue(undefined)
  jest.spyOn(core, 'error').mockImplementation(() => undefined)
  jest.mocked(k8s.waitForPodPhases).mockResolvedValue(undefined)
})

afterEach(() => {
  process.env = originalEnv
  jest.restoreAllMocks()
})

describe('prepare job externals', () => {
  let tempDir: string
  let sourcePath: string
  let destinationPath: string
  let responsePath: string
  let args: PrepareJobArgs

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-externals-'))
    sourcePath = path.join(tempDir, 'runner', 'externals')
    destinationPath = path.join(
      tempDir,
      'mounted-work',
      '_temp',
      '_runner_externals'
    )
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
    responsePath = path.join(tempDir, 'response.json')
    fs.writeFileSync(responsePath, '')
    process.env.RUNNER_WORKSPACE = path.join(tempDir, 'mounted-work', 'repo')
    fs.mkdirSync(path.join(sourcePath, 'node24', 'bin'), { recursive: true })
    fs.writeFileSync(path.join(sourcePath, 'node24', 'bin', 'node'), 'runtime')
    args = {
      container: {
        image: 'node:24',
        workingDirectory: '/__w/repo/repo',
        systemMountVolumes: [
          {
            sourceVolumePath: path.join(tempDir, 'mounted-work'),
            targetVolumePath: '/__w',
            readOnly: false
          },
          {
            sourceVolumePath: sourcePath,
            targetVolumePath: '/__e',
            readOnly: true
          }
        ]
      }
    }
    jest.mocked(k8s.createPod).mockResolvedValue({
      metadata: { name: 'workflow-pod' }
    })
    jest.mocked(k8s.isPodContainerAlpine).mockResolvedValue(false)
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('copies configured externals into the runner-internal directory mounted at /__e', async () => {
    jest.mocked(k8s.createPod).mockImplementation(async () => {
      expect(
        fs.readFileSync(
          path.join(destinationPath, 'node24', 'bin', 'node'),
          'utf8'
        )
      ).toBe('runtime')
      return { metadata: { name: 'workflow-pod' } }
    })

    await prepareJob(args, responsePath)

    expect(k8s.createPod).toHaveBeenCalledTimes(1)
    const [jobContainer] = jest.mocked(k8s.createPod).mock.calls[0]
    expect(jobContainer?.volumeMounts).toEqual(
      expect.arrayContaining([
        {
          name: 'work',
          mountPath: '/__e',
          subPath: '_temp/_runner_externals'
        }
      ])
    )
    expect(JSON.parse(fs.readFileSync(responsePath, 'utf8')).state.jobPod).toBe(
      'workflow-pod'
    )
  })

  it('preserves an existing checkout for a repository named externals', async () => {
    const workspace = path.join(tempDir, 'mounted-work', 'externals')
    const checkout = path.join(workspace, 'externals')
    fs.mkdirSync(checkout, { recursive: true })
    fs.writeFileSync(path.join(checkout, 'README.md'), 'repository contents')
    process.env.RUNNER_WORKSPACE = workspace
    process.env.GITHUB_WORKSPACE = checkout
    args.container!.workingDirectory = '/__w/externals/externals'

    await prepareJob(args, responsePath)

    expect(fs.readFileSync(path.join(checkout, 'README.md'), 'utf8')).toBe(
      'repository contents'
    )
    expect(
      fs.readFileSync(
        path.join(destinationPath, 'node24', 'bin', 'node'),
        'utf8'
      )
    ).toBe('runtime')
  })

  it('overwrites previously copied externals', async () => {
    fs.mkdirSync(path.join(destinationPath, 'node24', 'bin'), {
      recursive: true
    })
    fs.writeFileSync(path.join(destinationPath, 'node24', 'bin', 'node'), 'old')

    await prepareJob(args, responsePath)

    expect(
      fs.readFileSync(
        path.join(destinationPath, 'node24', 'bin', 'node'),
        'utf8'
      )
    ).toBe('runtime')
  })

  it('stages a complete copy in a fresh private directory before replacing the old tree', async () => {
    fs.mkdirSync(destinationPath)
    fs.writeFileSync(path.join(destinationPath, 'stale-runtime'), 'old')
    const copy = fs.promises.cp
    jest
      .spyOn(fs.promises, 'cp')
      .mockImplementation(async (source, target, options) => {
        const stagingRoot = path.dirname(target.toString())
        expect(path.dirname(stagingRoot)).toBe(path.dirname(destinationPath))
        expect(path.basename(stagingRoot)).toMatch(/^\.externals-/)
        expect(fs.statSync(stagingRoot).mode & 0o777).toBe(0o700)
        expect(
          fs.readFileSync(path.join(destinationPath, 'stale-runtime'), 'utf8')
        ).toBe('old')
        await copy(source, target, options)
      })

    await prepareJob(args, responsePath)

    expect(fs.existsSync(path.join(destinationPath, 'stale-runtime'))).toBe(
      false
    )
    expect(fs.readdirSync(path.dirname(destinationPath))).toEqual([
      '_runner_externals'
    ])
  })

  it('waits for previous pods to stop before staging externals', async () => {
    let finishCleanup: () => void = () => {
      throw new Error('Cleanup has not started')
    }
    let cleanupStarted: () => void = () => undefined
    const started = new Promise<void>(resolve => {
      cleanupStarted = resolve
    })
    jest.mocked(k8s.prunePods).mockImplementation(async () => {
      await new Promise<void>(resolve => {
        finishCleanup = resolve
        cleanupStarted()
      })
    })

    const preparation = prepareJob(args, responsePath)
    await started
    expect(k8s.pruneJobs).toHaveBeenCalledTimes(1)
    expect(fs.readdirSync(path.dirname(destinationPath))).toEqual([])
    expect(k8s.createPod).not.toHaveBeenCalled()
    finishCleanup()
    await preparation
    expect(fs.existsSync(destinationPath)).toBe(true)
  })

  it.each(['pruneJobs', 'prunePods'] as const)(
    'does not copy externals or create a pod if %s fails',
    async operation => {
      const error = new Error('Previous workloads could not be stopped')
      jest.mocked(k8s[operation]).mockRejectedValue(error)

      await expect(prepareJob(args, responsePath)).rejects.toBe(error)

      expect(fs.readdirSync(path.dirname(destinationPath))).toEqual([])
      expect(k8s.createPod).not.toHaveBeenCalled()
    }
  )

  it.each(['externals', 'node24', 'bin', 'node'])(
    'replaces a destination symlink at %s without modifying runner files',
    async component => {
      const outsidePath = path.join(tempDir, 'outside-work')
      const relativePaths = {
        externals: '',
        node24: 'node24',
        bin: 'node24/bin',
        node: 'node24/bin/node'
      }
      const linkPath = path.join(destinationPath, relativePaths[component])
      const targetPath = path.join(outsidePath, relativePaths[component])
      const sentinelPath = path.join(outsidePath, 'node24', 'bin', 'node')
      fs.mkdirSync(path.dirname(sentinelPath), { recursive: true })
      fs.writeFileSync(sentinelPath, 'runner-file')
      fs.mkdirSync(path.dirname(linkPath), { recursive: true })
      fs.symlinkSync(targetPath, linkPath)

      await prepareJob(args, responsePath)

      expect(fs.readFileSync(sentinelPath, 'utf8')).toBe('runner-file')
      expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(false)
      expect(
        fs.readFileSync(
          path.join(destinationPath, 'node24', 'bin', 'node'),
          'utf8'
        )
      ).toBe('runtime')
    }
  )

  it.each(['symlink', 'file'])(
    'rejects a substituted _temp parent of type %s without modifying runner files',
    async parentType => {
      const tempRoot = path.dirname(destinationPath)
      const outsidePath = path.join(tempDir, 'outside-work')
      fs.mkdirSync(outsidePath)
      fs.writeFileSync(path.join(outsidePath, 'sentinel'), 'runner-file')
      fs.rmdirSync(tempRoot)
      if (parentType === 'symlink') {
        fs.symlinkSync(outsidePath, tempRoot, 'dir')
      } else {
        fs.writeFileSync(tempRoot, 'not a directory')
      }

      await expect(prepareJob(args, responsePath)).rejects.toThrow(
        'Runner _temp must be a directory, not a symlink or file'
      )

      expect(fs.readFileSync(path.join(outsidePath, 'sentinel'), 'utf8')).toBe(
        'runner-file'
      )
      expect(fs.readdirSync(outsidePath)).toEqual(['sentinel'])
      expect(k8s.createPod).not.toHaveBeenCalled()
    }
  )

  it.each(['relative', 'absolute'])(
    'copies a runtime with a %s symlink without depending on the source',
    async linkType => {
      const runtimePath = path.join(sourcePath, 'node24', 'bin', 'node')
      const targetPath = `${runtimePath}.real`
      fs.renameSync(runtimePath, targetPath)
      fs.symlinkSync(
        linkType === 'relative' ? 'node.real' : targetPath,
        runtimePath
      )

      await prepareJob(args, responsePath)
      fs.rmSync(sourcePath, { recursive: true })

      const copiedRuntime = path.join(destinationPath, 'node24', 'bin', 'node')
      expect(fs.lstatSync(copiedRuntime).isSymbolicLink()).toBe(false)
      expect(fs.readFileSync(copiedRuntime, 'utf8')).toBe('runtime')
    }
  )

  it('copies a symlinked externals directory without depending on its target', async () => {
    const targetPath = path.join(tempDir, 'external-runtimes')
    fs.renameSync(sourcePath, targetPath)
    fs.symlinkSync(targetPath, sourcePath, 'dir')

    await prepareJob(args, responsePath)
    fs.rmSync(targetPath, { recursive: true })

    expect(fs.lstatSync(destinationPath).isSymbolicLink()).toBe(false)
    expect(
      fs.readFileSync(
        path.join(destinationPath, 'node24', 'bin', 'node'),
        'utf8'
      )
    ).toBe('runtime')
  })

  it('rejects a missing externals system mount', async () => {
    args.container!.systemMountVolumes = []

    await expect(prepareJob(args, responsePath)).rejects.toThrow(
      'Job container systemMountVolumes must include a sourceVolumePath for /__e'
    )
    expect(k8s.createPod).not.toHaveBeenCalled()
  })

  it('rejects a missing runner workspace', async () => {
    delete process.env.RUNNER_WORKSPACE

    await expect(prepareJob(args, responsePath)).rejects.toThrow(
      'RUNNER_WORKSPACE is not set'
    )
    expect(k8s.createPod).not.toHaveBeenCalled()
  })

  it('propagates copy failures without creating a pod', async () => {
    fs.mkdirSync(destinationPath)
    fs.writeFileSync(path.join(destinationPath, 'old-runtime'), 'old')
    fs.rmSync(sourcePath, { recursive: true })

    await expect(prepareJob(args, responsePath)).rejects.toThrow(/ENOENT/)
    expect(k8s.createPod).not.toHaveBeenCalled()
    expect(
      fs.readFileSync(path.join(destinationPath, 'old-runtime'), 'utf8')
    ).toBe('old')
    expect(fs.readdirSync(path.dirname(destinationPath))).toEqual([
      '_runner_externals'
    ])
  })

  it('removes the staging directory if publishing the copy fails', async () => {
    jest
      .spyOn(fs.promises, 'rename')
      .mockRejectedValue(new Error('rename failed'))

    await expect(prepareJob(args, responsePath)).rejects.toThrow(
      'rename failed'
    )

    expect(fs.readdirSync(path.dirname(destinationPath))).toEqual([])
    expect(k8s.createPod).not.toHaveBeenCalled()
  })
})

describe('container step lifecycle', () => {
  const args: RunContainerStepArgs = {
    image: 'ubuntu:latest',
    workingDirectory: '/github/workspace',
    systemMountVolumes: []
  }

  beforeEach(() => {
    jest.mocked(k8s.createSecretForEnvs).mockResolvedValue('step-env')
    jest.mocked(k8s.createJob).mockResolvedValue({
      metadata: { name: 'step-job' }
    })
    jest.mocked(k8s.getContainerJobPodName).mockResolvedValue('step-pod')
    jest.mocked(k8s.getPodLogs).mockResolvedValue(undefined)
    jest.mocked(k8s.waitForContainerToTerminate).mockResolvedValue({
      exitCode: 0
    })
    jest.mocked(k8s.deleteJob).mockResolvedValue(undefined)
    jest.mocked(k8s.deletePod).mockResolvedValue(undefined)
  })

  it.each([
    ['sh', false],
    ['/bin/sh', false],
    ['bash', false],
    ['/bin/bash', false],
    ['sh', true],
    ['bash', true]
  ] as const)(
    'preserves the script and positional arguments for %s (runner-quoted: %s)',
    async (entryPoint, runnerQuoted) => {
      const entryPointArgs = ['-c', 'printf "%s" "$1"', 'label', 'hello world']
      await runContainerStep({
        ...args,
        entryPoint,
        entryPointArgs: runnerQuoted
          ? entryPointArgs
              .map(arg => `"${arg.replace(/"/g, '\\"')}"`)
              .join(' ')
              .split(' ')
          : entryPointArgs
      })

      const container = jest.mocked(k8s.createJob).mock.calls[0][0]
      expect(container.command).toEqual([entryPoint])
      expect(container.args).toEqual(entryPointArgs)
      const result = spawnSync(entryPoint, container.args, { encoding: 'utf8' })
      expect(result.status).toBe(0)
      expect(result.stdout).toBe('hello world')
    }
  )

  it.each([
    [undefined, 600],
    ['1800', 1800]
  ])('uses startup timeout %p as %p seconds', async (configured, expected) => {
    if (configured !== undefined) {
      process.env.ACTIONS_RUNNER_PREPARE_JOB_TIMEOUT_SECONDS = configured
    }

    await runContainerStep(args)

    expect(k8s.waitForPodPhases).toHaveBeenCalledWith(
      'step-pod',
      new Set([
        utils.PodPhase.COMPLETED,
        utils.PodPhase.RUNNING,
        utils.PodPhase.SUCCEEDED,
        utils.PodPhase.FAILED
      ]),
      new Set([utils.PodPhase.PENDING, utils.PodPhase.UNKNOWN]),
      expected
    )
  })

  it.each([0, 3])(
    'cleans up the step and sidecars after exit code %p',
    async exitCode => {
      jest.spyOn(utils, 'readExtensionFromFile').mockReturnValue({
        spec: {
          containers: [
            {
              name: 'sidecar',
              image: 'ubuntu:latest',
              command: ['sleep', '600']
            }
          ]
        }
      })
      jest
        .mocked(k8s.waitForContainerToTerminate)
        .mockResolvedValue({ exitCode })

      await expect(runContainerStep(args)).resolves.toBe(exitCode)

      expect(k8s.waitForContainerToTerminate).toHaveBeenCalledWith(
        'step-pod',
        JOB_CONTAINER_NAME
      )
      expect(k8s.deleteJob).toHaveBeenCalledTimes(1)
      expect(k8s.deleteJob).toHaveBeenCalledWith('step-job')
      expect(k8s.deletePod).toHaveBeenCalledTimes(1)
      expect(k8s.deletePod).toHaveBeenCalledWith('step-pod')
      expect(
        jest.mocked(k8s.deleteJob).mock.invocationCallOrder[0]
      ).toBeGreaterThan(
        jest.mocked(k8s.waitForContainerToTerminate).mock.invocationCallOrder[0]
      )
      expect(
        jest.mocked(k8s.deletePod).mock.invocationCallOrder[0]
      ).toBeGreaterThan(jest.mocked(k8s.deleteJob).mock.invocationCallOrder[0])
    }
  )

  it.each([
    'waitForPodPhases',
    'getPodLogs',
    'waitForContainerToTerminate'
  ] as const)('cleans up while preserving a %s failure', async operation => {
    const error = new Error(`${operation} failed`)
    jest.mocked(k8s[operation]).mockRejectedValue(error)

    await expect(runContainerStep(args)).rejects.toBe(error)

    expect(k8s.deleteJob).toHaveBeenCalledTimes(1)
    expect(k8s.deleteJob).toHaveBeenCalledWith('step-job')
    expect(k8s.deletePod).toHaveBeenCalledTimes(1)
    expect(k8s.deletePod).toHaveBeenCalledWith('step-pod')
  })

  it('deletes the job if pod discovery fails', async () => {
    jest
      .mocked(k8s.getContainerJobPodName)
      .mockRejectedValue(new Error('lookup failed'))

    await expect(runContainerStep(args)).rejects.toThrow(
      'failed to get container job pod name: lookup failed'
    )

    expect(k8s.deleteJob).toHaveBeenCalledTimes(1)
    expect(k8s.deleteJob).toHaveBeenCalledWith('step-job')
    expect(k8s.deletePod).not.toHaveBeenCalled()
  })

  it('does not delete resources when job creation fails', async () => {
    jest.mocked(k8s.createJob).mockRejectedValue(new Error('create failed'))

    await expect(runContainerStep(args)).rejects.toThrow(
      'failed to run container step: create failed'
    )

    expect(k8s.deleteJob).not.toHaveBeenCalled()
    expect(k8s.deletePod).not.toHaveBeenCalled()
  })

  it('still deletes the pod and preserves the step failure if deleting the job fails', async () => {
    const error = new Error('step failed')
    jest.mocked(k8s.getPodLogs).mockRejectedValue(error)
    jest.mocked(k8s.deleteJob).mockRejectedValue(new Error('delete failed'))

    await expect(runContainerStep(args)).rejects.toBe(error)

    expect(k8s.deletePod).toHaveBeenCalledTimes(1)
    expect(k8s.deletePod).toHaveBeenCalledWith('step-pod')
    expect(core.error).toHaveBeenCalledWith(
      'Failed to delete step job step-job: delete failed'
    )
  })

  it('reports pod deletion failures without masking the exit code', async () => {
    jest.mocked(k8s.deletePod).mockRejectedValue(new Error('delete failed'))

    await expect(runContainerStep(args)).resolves.toBe(0)

    expect(core.error).toHaveBeenCalledWith(
      'Failed to delete step pod step-pod: delete failed'
    )
  })
})
