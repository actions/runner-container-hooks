import * as fs from 'fs'
import * as path from 'path'
import { runContainerStep } from '../src/hooks'
import { TestHelper } from './test-setup'

jest.useRealTimers()

let testHelper: TestHelper

let runContainerStepJsonPath = path.resolve(
  `${__dirname}/../../../examples/run-container-step.json`
)

let runContainerStepData: any

describe('Run container step', () => {
  beforeEach(async () => {
    const content = fs.readFileSync(runContainerStepJsonPath)
    runContainerStepData = JSON.parse(content.toString())
    testHelper = new TestHelper()
    await testHelper.initialize()
  })

  afterEach(async () => {
    await testHelper.cleanup()
  })

  it('should not throw', async () => {
    const exitCode = await runContainerStep(runContainerStepData.args)
    expect(exitCode).toBe(0)
  })

  it('should fail if the working directory does not exist', async () => {
    runContainerStepData.args.workingDirectory = '/foo/bar'
    await expect(runContainerStep(runContainerStepData.args)).rejects.toThrow()
  })

  it('should shold have env variables available', async () => {
    runContainerStepData.args.entryPoint = 'bash'
    runContainerStepData.args.entryPointArgs = [
      '-c',
      "'if [[ -z $NODE_ENV ]]; then exit 1; fi'"
    ]
    await expect(
      runContainerStep(runContainerStepData.args)
    ).resolves.not.toThrow()
  })
})
