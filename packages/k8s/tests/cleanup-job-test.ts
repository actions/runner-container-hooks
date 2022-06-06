import * as path from 'path'
import * as fs from 'fs'
import { prepareJob, cleanupJob } from '../src/hooks'
import { TestHelper } from './test-setup'

let testHelper: TestHelper

const prepareJobJsonPath = path.resolve(
  `${__dirname}/../../../examples/prepare-job.json`
)

let prepareJobOutputFilePath: string

describe('Cleanup Job', () => {
  beforeEach(async () => {
    const prepareJobJson = fs.readFileSync(prepareJobJsonPath)
    let prepareJobData = JSON.parse(prepareJobJson.toString())

    testHelper = new TestHelper()
    await testHelper.initialize()
    prepareJobOutputFilePath = testHelper.createFile('prepare-job-output.json')
    await prepareJob(prepareJobData.args, prepareJobOutputFilePath)
  })
  it('should not throw', async () => {
    await expect(cleanupJob()).resolves.not.toThrow()
  })
  afterEach(async () => {
    await testHelper.cleanup()
  })
})
