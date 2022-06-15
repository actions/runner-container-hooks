import { cleanupJob, prepareJob } from '../src/hooks'
import { TestHelper } from './test-setup'

let testHelper: TestHelper

describe('Cleanup Job', () => {
  beforeEach(async () => {
    testHelper = new TestHelper()
    await testHelper.initialize()
    let prepareJobData = testHelper.getPrepareJobDefinition()
    const prepareJobOutputFilePath = testHelper.createFile(
      'prepare-job-output.json'
    )
    await prepareJob(prepareJobData.args, prepareJobOutputFilePath)
  })
  it('should not throw', async () => {
    await expect(cleanupJob()).resolves.not.toThrow()
  })
  afterEach(async () => {
    await testHelper.cleanup()
  })
})
