import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { RunScriptStepArgs } from 'hooklib'
import { runScriptStep } from '../src/hooks/run-script-step'
import { execCpFromPod, execCpToPod, execPodStep } from '../src/k8s'
import { writeRunScript } from '../src/k8s/utils'

jest.mock('../src/k8s', () => ({
  execCpFromPod: jest.fn(),
  execCpToPod: jest.fn(),
  execPodStep: jest.fn()
}))

jest.mock('@actions/core', () => ({
  debug: jest.fn()
}))

jest.mock('../src/k8s/utils', () => ({
  ...jest.requireActual('../src/k8s/utils'),
  writeRunScript: jest.fn()
}))

describe('runner workspace synchronization', () => {
  let root: string
  let runnerRoot: string
  let podRoot: string
  let args: RunScriptStepArgs
  const originalEnv = { ...process.env }
  const state = { jobPod: 'job-pod' }

  beforeEach(() => {
    jest.resetAllMocks()
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'novolume-workspace-'))
    runnerRoot = path.join(root, 'runner')
    podRoot = path.join(root, 'pod')
    for (const directory of [
      path.join(runnerRoot, 'repo', 'repo'),
      path.join(runnerRoot, '_temp'),
      path.join(runnerRoot, '_actions'),
      path.join(podRoot, 'repo', 'repo', 'composite'),
      path.join(podRoot, '_temp', '_runner_file_commands')
    ]) {
      fs.mkdirSync(directory, { recursive: true })
    }
    fs.writeFileSync(
      path.join(podRoot, 'repo', 'repo', 'composite', 'action.yaml'),
      'runs:\n  using: composite\n'
    )
    fs.writeFileSync(
      path.join(podRoot, '_temp', '_runner_file_commands', 'output'),
      'result=success\n'
    )
    fs.writeFileSync(path.join(runnerRoot, '_actions', 'sentinel'), 'keep')
    process.env.RUNNER_WORKSPACE = path.join(runnerRoot, 'repo')
    process.env.RUNNER_TEMP = path.join(runnerRoot, '_temp')
    process.env.GITHUB_WORKSPACE = path.join(runnerRoot, 'repo', 'repo')
    args = {
      workingDirectory: '/__w/repo/repo',
      entryPoint: 'sh',
      entryPointArgs: ['-c', 'true']
    }
    jest.mocked(writeRunScript).mockImplementation(() => {
      const runnerPath = path.join(runnerRoot, '_temp', 'script.sh')
      fs.writeFileSync(runnerPath, 'true')
      return { runnerPath, containerPath: '/__w/_temp/script.sh' }
    })
    jest.mocked(execPodStep).mockResolvedValue(0)
    jest
      .mocked(execCpToPod)
      .mockImplementation(async (_, source, destination) => {
        await fs.promises.cp(
          source,
          path.join(podRoot, path.relative('/__w', destination)),
          { recursive: true }
        )
      })
    jest.mocked(execCpFromPod).mockImplementation(async (_, source, parent) => {
      await fs.promises.cp(
        path.join(podRoot, path.relative('/__w', source)),
        path.join(parent, path.basename(source)),
        { recursive: true }
      )
    })
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('makes a checked-out local action available to the runner', async () => {
    await runScriptStep(args, state)

    expect(
      fs.readFileSync(
        path.join(runnerRoot, 'repo', 'repo', 'composite', 'action.yaml'),
        'utf8'
      )
    ).toContain('using: composite')
    expect(
      fs.readFileSync(
        path.join(runnerRoot, '_temp', '_runner_file_commands', 'output'),
        'utf8'
      )
    ).toBe('result=success\n')
    expect(
      fs.readFileSync(path.join(runnerRoot, '_actions', 'sentinel'), 'utf8')
    ).toBe('keep')
  })

  it('rejects missing job state before executing or copying files', async () => {
    await expect(runScriptStep(args, undefined)).rejects.toThrow(
      'Job pod is missing from hook state'
    )
    expect(execPodStep).not.toHaveBeenCalled()
    expect(execCpFromPod).not.toHaveBeenCalled()
  })

  it('copies actions downloaded after preparation for nested composite steps', async () => {
    const action = path.join('_actions', 'owner', 'action', 'main', 'index.js')
    fs.mkdirSync(path.dirname(path.join(runnerRoot, action)), {
      recursive: true
    })
    fs.writeFileSync(
      path.join(runnerRoot, action),
      'console.log("nested action")'
    )

    await runScriptStep(args, state)

    expect(fs.readFileSync(path.join(podRoot, action), 'utf8')).toBe(
      'console.log("nested action")'
    )
    expect(execCpToPod).toHaveBeenCalledWith(
      state.jobPod,
      path.join(runnerRoot, '_actions'),
      '/__w/_actions'
    )
  })

  it('allows script-only jobs without a downloaded actions directory', async () => {
    fs.rmSync(path.join(runnerRoot, '_actions'), { recursive: true })

    await expect(runScriptStep(args, state)).resolves.toBeUndefined()
    expect(execCpToPod).not.toHaveBeenCalledWith(
      state.jobPod,
      path.join(runnerRoot, '_actions'),
      '/__w/_actions'
    )
  })

  it.each([undefined, 'relative/path', '/'])(
    'rejects unsafe runner workspace %s',
    async workspace => {
      if (workspace === undefined) {
        delete process.env.RUNNER_WORKSPACE
      } else {
        process.env.RUNNER_WORKSPACE = workspace
      }

      await expect(runScriptStep(args, state)).rejects.toThrow(
        'RUNNER_WORKSPACE'
      )
      expect(execPodStep).not.toHaveBeenCalled()
      expect(execCpFromPod).not.toHaveBeenCalled()
    }
  )

  it('removes stale files rather than leaving deleted local actions behind', async () => {
    await runScriptStep(args, state)
    fs.rmSync(path.join(podRoot, 'repo', 'repo', 'composite'), {
      recursive: true
    })
    fs.writeFileSync(path.join(podRoot, 'repo', 'repo', 'new-file'), 'new')

    await runScriptStep(args, state)

    expect(
      fs.existsSync(path.join(runnerRoot, 'repo', 'repo', 'composite'))
    ).toBe(false)
    expect(
      fs.readFileSync(path.join(runnerRoot, 'repo', 'repo', 'new-file'), 'utf8')
    ).toBe('new')
  })

  it('synchronizes failed steps for subsequent always or continue-on-error steps', async () => {
    jest
      .mocked(execPodStep)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockRejectedValueOnce(new Error('step exited 1'))

    await expect(runScriptStep(args, state)).rejects.toThrow('step exited 1')
    expect(
      fs.existsSync(
        path.join(runnerRoot, 'repo', 'repo', 'composite', 'action.yaml')
      )
    ).toBe(true)
    expect(
      fs.existsSync(
        path.join(runnerRoot, '_temp', '_runner_file_commands', 'output')
      )
    ).toBe(true)
  })

  it('preserves the previous workspace and reports failed transfers', async () => {
    fs.writeFileSync(path.join(runnerRoot, 'repo', 'sentinel'), 'keep')
    jest.mocked(execCpFromPod).mockRejectedValue(new Error('transfer failed'))

    await expect(runScriptStep(args, state)).rejects.toThrow('transfer failed')
    expect(
      fs.readFileSync(path.join(runnerRoot, 'repo', 'sentinel'), 'utf8')
    ).toBe('keep')
    expect(fs.readdirSync(path.join(runnerRoot, '_temp'))).toEqual([])
    expect(
      fs.readdirSync(runnerRoot).some(name => name.startsWith('.workspace-'))
    ).toBe(false)
  })

  it('reports both execution and synchronization errors', async () => {
    jest
      .mocked(execPodStep)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockRejectedValueOnce(new Error('step exited 1'))
    jest.mocked(execCpFromPod).mockRejectedValue(new Error('transfer failed'))

    await expect(runScriptStep(args, state)).rejects.toThrow(
      /step exited 1.*transfer failed/
    )
  })

  it('rejects a substituted workspace root before replacing runner files', async () => {
    fs.writeFileSync(path.join(runnerRoot, 'repo', 'sentinel'), 'keep')
    jest.mocked(execCpFromPod).mockImplementation(async (_, source, parent) => {
      await fs.promises.symlink(
        root,
        path.join(parent, path.basename(source)),
        'dir'
      )
    })

    await expect(runScriptStep(args, state)).rejects.toThrow(
      'Copied workspace must be a directory'
    )
    expect(
      fs.readFileSync(path.join(runnerRoot, 'repo', 'sentinel'), 'utf8')
    ).toBe('keep')
  })

  it('does not follow existing destination symlinks', async () => {
    const outside = path.join(root, 'outside')
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'action.yaml'), 'keep')
    fs.symlinkSync(
      outside,
      path.join(runnerRoot, 'repo', 'repo', 'composite'),
      'dir'
    )

    await runScriptStep(args, state)

    expect(fs.readFileSync(path.join(outside, 'action.yaml'), 'utf8')).toBe(
      'keep'
    )
    expect(
      fs
        .lstatSync(path.join(runnerRoot, 'repo', 'repo', 'composite'))
        .isDirectory()
    ).toBe(true)
  })
})
