import * as core from '@actions/core'
import { ApiException } from '@kubernetes/client-node'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { PrepareJobArgs, RunContainerStepArgs } from 'hooklib'
import { prepareJob } from '../src/hooks/prepare-job'
import { runContainerStep } from '../src/hooks/run-container-step'
import { JOB_CONTAINER_NAME } from '../src/hooks/constants'
import * as k8s from '../src/k8s'
import * as utils from '../src/k8s/utils'

jest.mock('../src/k8s', () => ({
  ...jest.requireActual('../src/k8s'),
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
    destinationPath = path.join(tempDir, 'mounted-work', 'externals')
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

  it('copies configured externals into the shared work root before creating the pod', async () => {
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
    expect(JSON.parse(fs.readFileSync(responsePath, 'utf8')).state.jobPod).toBe(
      'workflow-pod'
    )
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
    fs.rmSync(sourcePath, { recursive: true })

    await expect(prepareJob(args, responsePath)).rejects.toThrow(/ENOENT/)
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

  it('tolerates a pod already removed by Job garbage collection', async () => {
    jest
      .mocked(k8s.deletePod)
      .mockRejectedValue(new ApiException(404, 'Not Found', undefined, {}))

    await expect(runContainerStep(args)).resolves.toBe(0)

    expect(k8s.deletePod).toHaveBeenCalledTimes(1)
    expect(k8s.deletePod).toHaveBeenCalledWith('step-pod')
    expect(core.error).not.toHaveBeenCalled()
  })
})
