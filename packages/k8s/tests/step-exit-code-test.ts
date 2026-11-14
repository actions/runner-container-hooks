import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Command, HookData } from 'hooklib'
import { commandExitCode } from '../src/k8s/step-exit-code'
import { finishStep } from '../src/step-result'

const failure = (code: string) => ({
  status: 'Failure',
  reason: 'NonZeroExitCode',
  details: { causes: [{ reason: 'ExitCode', message: code }] }
})

describe('structured workload status', () => {
  test('success is zero, not the HTTP status', () => {
    expect(commandExitCode({ status: 'Success', code: 200 })).toBe(0)
  })
  test.each([1, 17, 137, 255])('preserves exit %i', code => {
    expect(commandExitCode(failure(String(code)))).toBe(code)
  })
  test.each(['', '0', '-1', '256', '1.5', '17junk', ' 17', '017'])(
    'rejects malformed code %s',
    code => {
      expect(commandExitCode(failure(code))).toBeUndefined()
    }
  )
  test.each([
    { status: 'Failure', message: 'command terminated with exit code 17' },
    { ...failure('17'), reason: 'Forbidden' },
    { ...failure('17'), details: {} },
    {
      ...failure('17'),
      details: { causes: [{ reason: 'Other', message: '17' }] }
    },
    {
      ...failure('17'),
      details: {
        causes: [
          failure('17').details.causes[0],
          failure('17').details.causes[0]
        ]
      }
    },
    { status: 'Unknown' }
  ])(
    'unknown/ambiguous statuses remain infrastructure failures: %j',
    status => {
      expect(commandExitCode(status)).toBeUndefined()
    }
  )
})

describe('response capability negotiation', () => {
  let dir: string
  let input: HookData
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-result-'))
    input = {
      command: Command.RunScriptStep,
      responseFile: path.join(dir, 'response.json'),
      supportsStepExitCode: true
    }
    fs.writeFileSync(input.responseFile, '')
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))
  test.each([Command.RunScriptStep, Command.RunContainerStep])(
    '%s writes workload status while returning hook success',
    command => {
      input.command = command
      expect(finishStep(input, 17)).toBe(0)
      expect(JSON.parse(fs.readFileSync(input.responseFile, 'utf8'))).toEqual({
        exitCode: 17
      })
    }
  )
  test('success response', () => {
    expect(finishStep(input, 0)).toBe(0)
    expect(JSON.parse(fs.readFileSync(input.responseFile, 'utf8'))).toEqual({
      exitCode: 0
    })
  })
  test.each([undefined, false, 'true'])(
    'old/invalid capability %j cannot turn failure green',
    capability => {
      input.supportsStepExitCode = capability as boolean
      expect(finishStep(input, 17)).toBe(17)
      expect(fs.readFileSync(input.responseFile, 'utf8')).toBe('')
    }
  )
  test.each([-1, 256, NaN, 1.5])('rejects invalid exit %j', code => {
    expect(() => finishStep(input, code)).toThrow('Invalid workload exit code')
  })
  test.each([Command.PrepareJob, Command.CleanupJob])(
    'does not mask %s',
    command => {
      input.command = command
      expect(() => finishStep(input, 17)).toThrow()
    }
  )
  test('write failure cannot return hook success', () => {
    fs.unlinkSync(input.responseFile)
    expect(() => finishStep(input, 17)).toThrow()
  })
})
