import * as fs from 'fs'
import {
  cleanupJob,
  prepareJob,
  runContainerStep,
  runScriptStep
} from '../src/hooks'
import { TestHelper } from './test-setup'

jest.useRealTimers()

let testHelper: TestHelper

let prepareJobData: any

let prepareJobOutputFilePath: string
describe('e2e', () => {
  const fn = async () => {
    await expect(
      prepareJob(prepareJobData.args, prepareJobOutputFilePath)
    ).resolves.not.toThrow()

    const scriptStepData = testHelper.getRunScriptStepDefinition()

    const prepareJobOutputJson = fs.readFileSync(prepareJobOutputFilePath)
    const prepareJobOutputData = JSON.parse(prepareJobOutputJson.toString())

    await expect(
      runScriptStep(scriptStepData.args, prepareJobOutputData.state, null)
    ).resolves.not.toThrow()

    const runContainerStepData = testHelper.getRunContainerStepDefinition()

    await expect(
      runContainerStep(runContainerStepData.args)
    ).resolves.not.toThrow()

    await expect(cleanupJob()).resolves.not.toThrow()
  }
  describe('k8s config', () => {
    beforeEach(async () => {
      testHelper = new TestHelper('k8s')
      await testHelper.initialize()

      prepareJobData = testHelper.getPrepareJobDefinition()
      prepareJobOutputFilePath = testHelper.createFile(
        'prepare-job-output.json'
      )
    })
    afterEach(async () => {
      await testHelper.cleanup()
    })

    it(
      'should prepare job, run script step, run container step then cleanup without errors',
      fn
    )
  })

  describe('docker config', () => {
    beforeEach(async () => {
      testHelper = new TestHelper('docker')
      await testHelper.initialize()

      prepareJobData = testHelper.getPrepareJobDefinition()
      prepareJobOutputFilePath = testHelper.createFile(
        'prepare-job-output.json'
      )
    })
    afterEach(async () => {
      await testHelper.cleanup()
    })

    it(
      'should prepare job, run script step, run container step then cleanup without errors',
      fn
    )
  })
})
