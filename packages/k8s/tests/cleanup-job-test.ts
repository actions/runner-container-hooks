import * as path from 'path'
import * as fs from 'fs'
import { prepareJob, cleanupJob } from '../src/hooks'
import { TestTempOutput } from './test-setup'

let testTempOutput: TestTempOutput

const prepareJobJsonPath = path.resolve(
  `${__dirname}/../../../examples/prepare-job.json`
)

let prepareJobOutputFilePath: string

describe('Cleanup Job', () => {
  beforeEach(async () => {
    const prepareJobJson = fs.readFileSync(prepareJobJsonPath)
    let prepareJobData = JSON.parse(prepareJobJson.toString())

    testTempOutput = new TestTempOutput()
    testTempOutput.initialize()
    prepareJobOutputFilePath = testTempOutput.createFile(
      'prepare-job-output.json'
    )
    await prepareJob(prepareJobData.args, prepareJobOutputFilePath)
  })
  it('should not throw', async () => {
    const outputJson = fs.readFileSync(prepareJobOutputFilePath)
    const outputData = JSON.parse(outputJson.toString())
    await expect(cleanupJob()).resolves.not.toThrow()
  })
})
