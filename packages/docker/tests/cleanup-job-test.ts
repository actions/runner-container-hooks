import { PrepareJobArgs } from 'hooklib/lib'
import { cleanupJob, prepareJob } from '../src/hooks'
import TestSetup from './test-setup'

let testSetup: TestSetup

jest.useRealTimers()

describe('cleanup job', () => {
  beforeEach(async () => {
    testSetup = new TestSetup()
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

  it('should cleanup successfully', async () => {
    await expect(cleanupJob()).resolves.not.toThrow()
  })
})
