import { PrepareJobArgs } from 'hooklib/lib'
import { cleanupJob, prepareJob } from '../src/hooks'
import TestSetup, { TableTest } from './test-setup'

let testSetup: TestSetup

jest.useRealTimers()

describe('cleanup job', () => {
  const cases = [] as TableTest[]

  cases.push({
    name: 'should cleanup successfully',
    fn: async () => {
      await expect(cleanupJob()).resolves.not.toThrow()
    }
  })

  describe('k8s config', () => {
    beforeEach(async () => {
      testSetup = new TestSetup('k8s')
      testSetup.initialize()

      const prepareJobDefinition = testSetup.getPrepareJobDefinition()

      const prepareJobOutput = testSetup.createOutputFile(
        'prepare-job-output.json'
      )

      await prepareJob(
        prepareJobDefinition.args as PrepareJobArgs,
        prepareJobOutput
      )
    })

    afterEach(() => {
      testSetup.teardown()
    })

    cases.forEach(e => {
      it(e.name, e.fn)
    })
  })

  describe('docker config', () => {
    beforeEach(async () => {
      testSetup = new TestSetup('docker')
      testSetup.initialize()

      const prepareJobDefinition = testSetup.getPrepareJobDefinition()

      const prepareJobOutput = testSetup.createOutputFile(
        'prepare-job-output.json'
      )

      await prepareJob(
        prepareJobDefinition.args as PrepareJobArgs,
        prepareJobOutput
      )
    })

    afterEach(() => {
      testSetup.teardown()
    })

    cases.forEach(e => {
      it(e.name, e.fn)
    })
  })
})
