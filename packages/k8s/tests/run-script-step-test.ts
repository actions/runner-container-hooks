import * as fs from 'fs'
import * as path from 'path'
import { cleanupJob, prepareJob, runScriptStep } from '../src/hooks'
import { TestHelper } from './test-setup'

jest.useRealTimers()

let testHelper: TestHelper

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

    testHelper = new TestHelper()
    await testHelper.initialize()
    prepareJobOutputFilePath = testHelper.createFile('prepare-job-output.json')
    prepareJobData.args.container.userMountVolumes = []

    await prepareJob(prepareJobData.args, prepareJobOutputFilePath)
    const outputContent = fs.readFileSync(prepareJobOutputFilePath)
    prepareJobOutputData = JSON.parse(outputContent.toString())
  })

  afterEach(async () => {
    await cleanupJob()
    // await testHelper.cleanup()
  })

  // NOTE: To use this test, do kubectl apply -f podspec.yaml (from podspec examples)
  // then change the name of the file to 'run-script-step-test.ts' and do
  // npm run test run-script-step

  it('should not throw an exception', async () => {
    const args = {
      entryPointArgs: ['-c', 'echo "test"'],
      entryPoint: 'bash',
      environmentVariables: {
        NODE_ENV: 'development'
      },
      prependPath: [],
      workingDirectory: '/__w/repo/repo'
    }
    const state = {
      jobPod: prepareJobOutputData.state.jobPod
    }
    const responseFile = null
    await new Promise(r => setTimeout(r, 300000))
    await expect(
      runScriptStep(args, state, responseFile)
    ).resolves.not.toThrow()
  })
})
