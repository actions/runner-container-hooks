import * as core from '@actions/core'
import * as k8s from '@kubernetes/client-node'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { execCpToPod } from '../src/k8s'
import * as utils from '../src/k8s/utils'

describe('copy verification exhaustion', () => {
  let root: string
  let scans: number
  let failure: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-verify-'))
    fs.writeFileSync(path.join(root, 'file'), 'payload')
    scans = 0
    process.env.ACTIONS_RUNNER_KUBERNETES_NAMESPACE = 'default'
    jest.spyOn(core, 'debug').mockImplementation(() => {})
    jest.spyOn(utils, 'sleep').mockResolvedValue()
    jest
      .spyOn(k8s.Exec.prototype, 'exec')
      .mockImplementation(
        async (
          _ns,
          _pod,
          _container,
          _command,
          stdout,
          _stderr,
          stdin,
          _tty,
          status
        ) => {
          if (stdin) {
            await new Promise<void>(resolve => {
              stdin.once('end', resolve)
              stdin.resume()
            })
            status?.({ status: 'Success' })
          } else {
            scans++
            if (failure === 'error')
              status?.({ status: 'Failure', message: 'scan failed' })
            else {
              stdout?.write(
                failure === 'recover' && scans === 15
                  ? (
                      await promisify(execFile)('sh', [
                        '-c',
                        utils.listDirAllCommand(root)
                      ])
                    ).stdout
                  : 'different metadata\n'
              )
              status?.({ status: 'Success' })
            }
          }
          return {} as any
        }
      )
  })

  afterEach(() => {
    jest.restoreAllMocks()
    fs.rmSync(root, { recursive: true, force: true })
  })

  test.each(['mismatch', 'error'])(
    'fails after 15 unsuccessful %s scans',
    async mode => {
      failure = mode
      await expect(execCpToPod('pod', root, '/target')).rejects.toThrow(
        'verification failed after 15 attempts'
      )
      expect(scans).toBe(15)
      expect(utils.sleep).toHaveBeenCalledTimes(15)
    }
  )

  it('accepts a match on the final allowed attempt', async () => {
    failure = 'recover'
    await expect(execCpToPod('pod', root, '/target')).resolves.toBeUndefined()
    expect(scans).toBe(15)
    expect(utils.sleep).toHaveBeenCalledTimes(14)
  })
})
