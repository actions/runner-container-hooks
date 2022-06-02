import * as fs from 'fs'
import * as path from 'path'
import { cleanupJob } from '../src/hooks'
import { prepareJob } from '../src/hooks/prepare-job'
import { TestTempOutput } from './test-setup'

jest.useRealTimers()

let testTempOutput: TestTempOutput

const prepareJobJsonPath = path.resolve(
  `${__dirname}/../../../examples/prepare-job.json`
)
let prepareJobData: any

let prepareJobOutputFilePath: string

describe('Prepare job', () => {
  beforeEach(() => {
    const prepareJobJson = fs.readFileSync(prepareJobJsonPath)
    prepareJobData = JSON.parse(prepareJobJson.toString())

    testTempOutput = new TestTempOutput()
    testTempOutput.initialize()
    prepareJobOutputFilePath = testTempOutput.createFile(
      'prepare-job-output.json'
    )
  })
  afterEach(async () => {
    const outputJson = fs.readFileSync(prepareJobOutputFilePath)
    const outputData = JSON.parse(outputJson.toString())
    await cleanupJob()
    testTempOutput.cleanup()
  })

  it('should not throw exception', async () => {
    await expect(
      prepareJob(prepareJobData.args, prepareJobOutputFilePath)
    ).resolves.not.toThrow()
  })

  it('should generate output file in JSON format', async () => {
    await prepareJob(prepareJobData.args, prepareJobOutputFilePath)
    const content = fs.readFileSync(prepareJobOutputFilePath)
    expect(() => JSON.parse(content.toString())).not.toThrow()
  })
})
