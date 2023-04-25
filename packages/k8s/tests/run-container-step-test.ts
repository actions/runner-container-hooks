import { runContainerStep } from '../src/hooks'
import { TableTest, TestHelper } from './test-setup'

jest.useRealTimers()

let testHelper: TestHelper

let runContainerStepData: any

describe('Run container step', () => {
  const cases = [] as TableTest[]

  cases.push({
    name: 'should not throw',
    fn: async () => {
      const exitCode = await runContainerStep(runContainerStepData.args)
      expect(exitCode).toBe(0)
    }
  })

  cases.push({
    name: 'should fail if the working directory does not exist',
    fn: async () => {
      runContainerStepData.args.workingDirectory = '/foo/bar'
      await expect(
        runContainerStep(runContainerStepData.args)
      ).rejects.toThrow()
    }
  })

  cases.push({
    name: 'should shold have env variables available',
    fn: async () => {
      runContainerStepData.args.entryPoint = 'bash'
      runContainerStepData.args.entryPointArgs = [
        '-c',
        "'if [[ -z $NODE_ENV ]]; then exit 1; fi'"
      ]
      await expect(
        runContainerStep(runContainerStepData.args)
      ).resolves.not.toThrow()
    }
  })

  describe('k8s config', () => {
    beforeEach(async () => {
      testHelper = new TestHelper('k8s')
      await testHelper.initialize()
      runContainerStepData = testHelper.getRunContainerStepDefinition()
    })

    afterEach(async () => {
      await testHelper.cleanup()
    })

    cases.forEach(e => {
      it(e.name, e.fn)
    })
  })

  describe('docker config', () => {
    beforeEach(async () => {
      testHelper = new TestHelper('docker')
      await testHelper.initialize()
      runContainerStepData = testHelper.getRunContainerStepDefinition()
    })

    afterEach(async () => {
      await testHelper.cleanup()
    })

    cases.forEach(e => {
      it(e.name, e.fn)
    })
  })
})
