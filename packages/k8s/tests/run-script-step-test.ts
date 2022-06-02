import { prepareJob, cleanupJob, runScriptStep } from '../src/hooks'
import { TestTempOutput } from './test-setup'
import * as path from 'path'
import * as fs from 'fs'

jest.useRealTimers()

let testTempOutput: TestTempOutput

const prepareJobJsonPath = path.resolve(
  `${__dirname}/../../../examples/prepare-job.json`
)
let prepareJobData: any

let prepareJobOutputFilePath: string
let prepareJobOutputData: any

describe('Run script step', () => {
  beforeEach(async () => {
    const prepareJobJson = fs.readFileSync(prepareJobJsonPath)
    prepareJobData = JSON.parse(prepareJobJson.toString())
    console.log(prepareJobData)

    testTempOutput = new TestTempOutput()
    testTempOutput.initialize()
    prepareJobOutputFilePath = testTempOutput.createFile(
      'prepare-job-output.json'
    )
    await prepareJob(prepareJobData.args, prepareJobOutputFilePath)
    const outputContent = fs.readFileSync(prepareJobOutputFilePath)
    prepareJobOutputData = JSON.parse(outputContent.toString())
  })

  afterEach(async () => {
    await cleanupJob()
    testTempOutput.cleanup()
  })

  // NOTE: To use this test, do kubectl apply -f podspec.yaml (from podspec examples)
  // then change the name of the file to 'run-script-step-test.ts' and do
  // npm run test run-script-step

  it('should not throw an exception', async () => {
    const args = {
      entryPointArgs: ['echo "test"'],
      entryPoint: '/bin/bash',
      environmentVariables: {
        NODE_ENV: 'development'
      },
      prependPath: ['/foo/bar', 'bar/foo'],
      workingDirectory: '/__w/thboop-test2/thboop-test2'
    }
    const state = {
      jobPod: prepareJobOutputData.state.jobPod
    }
    const responseFile = null
    await expect(
      runScriptStep(args, state, responseFile)
    ).resolves.not.toThrow()
  })
})
