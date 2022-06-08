import * as fs from 'fs'
import { cleanupJob, prepareJob } from '../src/hooks'
import TestSetup from './test-setup'

let testSetup: TestSetup

jest.useRealTimers()

describe('cleanup job', () => {
  beforeEach(async () => {
    testSetup = new TestSetup()
    testSetup.initialize()

    const prepareJobDefinition = JSON.parse(
      fs.readFileSync(
        `${__dirname}/../../../examples/prepare-job.json`,
        'utf-8'
      )
    )

    const prepareJobOutput = testSetup.createOutputFile(
      'prepare-job-output.json'
    )
    await prepareJob(prepareJobDefinition.args, prepareJobOutput)
  })

  afterEach(() => {
    testSetup.teardown()
  })

  it('should cleanup successfully', async () => {
    await expect(cleanupJob()).resolves.not.toThrow()
  })
})
