import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Command, getInputFromStdin } from 'hooklib'
import { runScriptStep, runContainerStep } from '../src/hooks'

jest.mock('hooklib', () => ({
  ...jest.requireActual('hooklib'),
  getInputFromStdin: jest.fn()
}))
jest.mock('../src/hooks', () => ({
  runScriptStep: jest.fn(),
  runContainerStep: jest.fn(),
  prepareJob: jest.fn(),
  cleanupJob: jest.fn()
}))
jest.mock('../src/k8s', () => ({
  isAuthPermissionsOK: jest.fn(async () => true)
}))

let dir: string
let exit: jest.SpyInstance
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-dispatch-'))
  exit = jest
    .spyOn(process, 'exit')
    .mockImplementation((() => undefined) as never)
  jest.mocked(runScriptStep).mockReset()
  jest.mocked(runContainerStep).mockReset()
})
afterEach(() => {
  exit.mockRestore()
  fs.rmSync(dir, { recursive: true, force: true })
})
test.each([Command.RunScriptStep, Command.RunContainerStep])(
  '%s dispatcher writes explicit failed workload status and exits zero',
  async command => {
    const responseFile = path.join(dir, 'response.json')
    fs.writeFileSync(responseFile, '')
    jest.mocked(getInputFromStdin).mockResolvedValue({
      command,
      responseFile,
      args: {} as never,
      state: {},
      supportsStepExitCode: true
    })
    jest.mocked(runScriptStep).mockResolvedValue(17)
    jest.mocked(runContainerStep).mockResolvedValue(17)
    await jest.isolateModulesAsync(async () => {
      await import('../src/index')
    })
    await new Promise(resolve => setImmediate(resolve))
    expect(exit).toHaveBeenCalledWith(0)
    expect(JSON.parse(fs.readFileSync(responseFile, 'utf8'))).toEqual({
      exitCode: 17
    })
  }
)
test('legacy dispatcher cannot convert failed command to success', async () => {
  const responseFile = path.join(dir, 'response.json')
  fs.writeFileSync(responseFile, '')
  jest.mocked(getInputFromStdin).mockResolvedValue({
    command: Command.RunScriptStep,
    responseFile,
    args: {} as never
  })
  jest.mocked(runScriptStep).mockResolvedValue(17)
  await jest.isolateModulesAsync(async () => {
    await import('../src/index')
  })
  await new Promise(resolve => setImmediate(resolve))
  expect(exit).toHaveBeenCalledWith(17)
  expect(fs.readFileSync(responseFile, 'utf8')).toBe('')
})
