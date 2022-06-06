import * as fs from 'fs'
import * as path from 'path'
import {
  cleanupJob,
  prepareJob,
  runContainerStep,
  runScriptStep
} from '../src/hooks'
import { TestHelper } from './test-setup'

jest.useRealTimers()

let testHelper: TestHelper

const prepareJobJsonPath = path.resolve(
  `${__dirname}/../../../examples/prepare-job.json`
)
const runScriptStepJsonPath = path.resolve(
  `${__dirname}/../../../examples/run-script-step.json`
)
let runContainerStepJsonPath = path.resolve(
  `${__dirname}/../../../examples/run-container-step.json`
)

let prepareJobData: any

let prepareJobOutputFilePath: string
describe('e2e', () => {
  beforeEach(async () => {
    const prepareJobJson = fs.readFileSync(prepareJobJsonPath)
    prepareJobData = JSON.parse(prepareJobJson.toString())

    testHelper = new TestHelper()
    await testHelper.initialize()
    prepareJobOutputFilePath = testHelper.createFile('prepare-job-output.json')
  })
  afterEach(async () => {
    await testHelper.cleanup()
  })
  it('should prepare job, run script step, run container step then cleanup without errors', async () => {
    await expect(
      prepareJob(prepareJobData.args, prepareJobOutputFilePath)
    ).resolves.not.toThrow()

    const scriptStepContent = fs.readFileSync(runScriptStepJsonPath)
    const scriptStepData = JSON.parse(scriptStepContent.toString())

    const prepareJobOutputJson = fs.readFileSync(prepareJobOutputFilePath)
    const prepareJobOutputData = JSON.parse(prepareJobOutputJson.toString())

    await expect(
      runScriptStep(scriptStepData.args, prepareJobOutputData.state, null)
    ).resolves.not.toThrow()

    const runContainerStepContent = fs.readFileSync(runContainerStepJsonPath)
    const runContainerStepData = JSON.parse(runContainerStepContent.toString())

    // await expect(
    // runContainerStep(runContainerStepData.args)
    // ).resolves.not.toThrow()

    await expect(cleanupJob()).resolves.not.toThrow()
  })
})
