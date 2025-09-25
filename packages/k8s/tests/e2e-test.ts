import * as fs from 'fs'
import {
  cleanupJob,
  prepareJob,
  runContainerStep,
  runScriptStep
} from '../src/hooks'
import { TestHelper } from './test-setup'
import { RunContainerStepArgs, RunScriptStepArgs } from 'hooklib'

jest.useRealTimers()

let testHelper: TestHelper

let prepareJobData: any

let prepareJobOutputFilePath: string
describe('e2e', () => {
  beforeEach(async () => {
    testHelper = new TestHelper()
    await testHelper.initialize()

    prepareJobData = testHelper.getPrepareJobDefinition()
    prepareJobOutputFilePath = testHelper.createFile('prepare-job-output.json')
  })
  afterEach(async () => {
    await testHelper.cleanup()
  })
  it('should prepare job, run script step, run container step then cleanup without errors', async () => {
    await expect(
      prepareJob(prepareJobData.args, prepareJobOutputFilePath)
    ).resolves.not.toThrow()

    const scriptStepData = testHelper.getRunScriptStepDefinition()

    const prepareJobOutputJson = fs.readFileSync(prepareJobOutputFilePath)
    const prepareJobOutputData = JSON.parse(prepareJobOutputJson.toString())

    await expect(
      runScriptStep(
        scriptStepData.args as RunScriptStepArgs,
        prepareJobOutputData.state
      )
    ).resolves.not.toThrow()

    const runContainerStepData = testHelper.getRunContainerStepDefinition()

    await expect(
      runContainerStep(runContainerStepData.args as RunContainerStepArgs)
    ).resolves.not.toThrow()

    await expect(cleanupJob()).resolves.not.toThrow()
  })
})
