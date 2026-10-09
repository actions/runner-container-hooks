import * as core from '@actions/core'
import * as k8s from '@kubernetes/client-node'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { spawn } from 'child_process'
import { execCpToPod } from '../src/k8s'
import * as utils from '../src/k8s/utils'

// Exercise real tar/find/chmod over the exec transport boundary without a cluster.
describe('copy timing diagnostics', () => {
  let root: string
  let source: string
  let destination: string
  let logs: string[]
  let failures: number
  let copies: number

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-copy-'))
    source = path.join(root, 'source')
    destination = path.join(root, "destination with ' quote")
    fs.mkdirSync(source)
    fs.mkdirSync(destination)
    fs.writeFileSync(path.join(source, 'line\nbreak'), 'payload', {
      mode: 0o400
    })
    fs.symlinkSync('line\nbreak', path.join(source, '--symlink'))
    process.env.ACTIONS_RUNNER_KUBERNETES_NAMESPACE = 'default'
    logs = []
    failures = 0
    copies = 0
    jest.spyOn(core, 'info').mockImplementation(line => {
      logs.push(line)
    })
    jest.spyOn(core, 'debug').mockImplementation(() => {})
    jest.spyOn(utils, 'sleep').mockResolvedValue()
    jest
      .spyOn(k8s.Exec.prototype, 'exec')
      .mockImplementation(
        async (
          _ns,
          _pod,
          _container,
          command,
          stdout,
          stderr,
          stdin,
          _tty,
          status
        ) => {
          if (stdin) {
            copies++
            if (copies <= failures) {
              await new Promise<void>(resolve => {
                stdin.once('end', resolve)
                stdin.resume()
              })
              stderr?.write('copy failure')
              status?.({ status: 'Success' })
              return {} as any
            }
          }
          const args = command as string[]
          const child = spawn(args[0], args.slice(1))
          child.stdout.on('data', data => stdout?.write(data))
          child.stderr.on('data', data => stderr?.write(data))
          if (stdin) stdin.pipe(child.stdin)
          else child.stdin.end()
          child.on('close', code =>
            status?.({ status: code === 0 ? 'Success' : 'Failure' })
          )
          return {} as any
        }
      )
  })

  afterEach(() => {
    jest.restoreAllMocks()
    delete process.env.ACTIONS_RUNNER_HOOK_TIMINGS
    fs.rmSync(root, { recursive: true, force: true })
  })

  test.each(['false', 'true'])(
    'copy preserves contents and permissions with timings=%s',
    async enabled => {
      process.env.ACTIONS_RUNNER_HOOK_TIMINGS = enabled
      await execCpToPod('pod', source, destination)
      expect(
        fs.readFileSync(path.join(destination, 'line\nbreak'), 'utf8')
      ).toBe('payload')
      expect(
        fs.statSync(path.join(destination, 'line\nbreak')).mode & 0o777
      ).toBe(0o600)
      expect(fs.readlinkSync(path.join(destination, '--symlink'))).toBe(
        'line\nbreak'
      )
      expect(copies).toBe(1)
      if (enabled === 'true') {
        const records = logs.map(line => JSON.parse(line))
        expect(records.slice(0, 4).map(record => record.phase)).toEqual([
          'extract',
          'file_permissions',
          'directory_permissions',
          'copy_transfer'
        ])
        // The baseline hash includes directory sizes, which can differ even
        // after a correct copy. Timing must preserve that bounded retry path.
        const mismatch =
          fs.statSync(source).size !== fs.statSync(destination).size
        const comparisons = records.filter(
          record => record.phase === 'verification'
        )
        expect(comparisons).toHaveLength(mismatch ? 15 : 1)
        for (const [i, record] of comparisons.entries()) {
          expect(record.attempt).toBe(i + 1)
          expect(record.result).toBe(Number(mismatch))
        }
        for (const record of records) {
          expect(record.durationMs).toBeGreaterThanOrEqual(0)
          if (record.phase !== 'verification') expect(record.result).toBe(0)
        }
        expect(logs.join('')).not.toContain(root)
      } else {
        expect(logs).toEqual([])
      }
    }
  )

  it('keeps nonempty stderr as a copy failure and retries only 30 times', async () => {
    process.env.ACTIONS_RUNNER_HOOK_TIMINGS = 'true'
    failures = 30
    await expect(execCpToPod('pod', source, destination)).rejects.toThrow(
      'cpToPod failed after 30 attempts'
    )
    expect(copies).toBe(30)
    expect(utils.sleep).toHaveBeenCalledTimes(29)
    const records = logs.map(line => JSON.parse(line))
    expect(records).toHaveLength(30)
    expect(records.every(record => record.result === 1)).toBe(true)
  })
})
