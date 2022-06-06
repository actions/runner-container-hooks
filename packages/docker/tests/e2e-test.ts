import * as fs from 'fs'
import * as path from 'path'
import { v4 as uuidv4 } from 'uuid'
import {
  cleanupJob,
  prepareJob,
  runContainerStep,
  runScriptStep
} from '../src/hooks'
import TestSetup from './test-setup'

const prepareJobJson = fs.readFileSync(
  path.resolve(__dirname + '/../../../examples/prepare-job.json'),
  'utf8'
)

const containerStepJson = fs.readFileSync(
  path.resolve(__dirname + '/../../../examples/run-container-step.json'),
  'utf8'
)

const tmpOutputDir = `${__dirname}/_temp/${uuidv4()}`

let prepareJobData: any
let scriptStepJson: any
let scriptStepData: any
let containerStepData: any

let prepareJobOutputFilePath: string

let testSetup: TestSetup

describe('e2e', () => {
  beforeAll(() => {
    fs.mkdirSync(tmpOutputDir, { recursive: true })
  })

  afterAll(() => {
    fs.rmSync(tmpOutputDir, { recursive: true })
  })

  beforeEach(() => {
    // init dirs
    testSetup = new TestSetup()
    testSetup.initialize()

    prepareJobData = JSON.parse(prepareJobJson)
    prepareJobData.args.container.userMountVolumes = testSetup.userMountVolumes
    prepareJobData.args.container.systemMountVolumes =
      testSetup.systemMountVolumes
    prepareJobData.args.container.workingDirectory = testSetup.workingDirectory

    scriptStepJson = fs.readFileSync(
      path.resolve(__dirname + '/../../../examples/run-script-step.json'),
      'utf8'
    )
    scriptStepData = JSON.parse(scriptStepJson)
    scriptStepData.args.workingDirectory = testSetup.workingDirectory

    containerStepData = JSON.parse(containerStepJson)
    containerStepData.args.workingDirectory = testSetup.workingDirectory
    containerStepData.args.userMountVolumes = testSetup.userMountVolumes
    containerStepData.args.systemMountVolumes = testSetup.systemMountVolumes

    prepareJobOutputFilePath = `${tmpOutputDir}/prepare-job-output-${uuidv4()}.json`
    fs.writeFileSync(prepareJobOutputFilePath, '')
  })

  afterEach(() => {
    fs.rmSync(prepareJobOutputFilePath, { force: true })
    testSetup.teardown()
  })

  it('should prepare job, then run script step, then run container step then cleanup', async () => {
    await expect(
      prepareJob(prepareJobData.args, prepareJobOutputFilePath)
    ).resolves.not.toThrow()
    let rawState = fs.readFileSync(prepareJobOutputFilePath, 'utf-8')
    let resp = JSON.parse(rawState)
    await expect(
      runScriptStep(scriptStepData.args, resp.state)
    ).resolves.not.toThrow()
    await expect(
      runContainerStep(containerStepData.args, resp.state)
    ).resolves.not.toThrow()
    await expect(cleanupJob()).resolves.not.toThrow()
  })

  it('should prepare job, then run script step, then run container step with Dockerfile then cleanup', async () => {
    await expect(
      prepareJob(prepareJobData.args, prepareJobOutputFilePath)
    ).resolves.not.toThrow()
    let rawState = fs.readFileSync(prepareJobOutputFilePath, 'utf-8')
    let resp = JSON.parse(rawState)
    await expect(
      runScriptStep(scriptStepData.args, resp.state)
    ).resolves.not.toThrow()

    const dockerfilePath = `${tmpOutputDir}/Dockerfile`
    fs.writeFileSync(
      dockerfilePath,
      `FROM ubuntu:latest
ENV TEST=test
ENTRYPOINT [ "tail", "-f", "/dev/null" ]
    `
    )
    const containerStepDataCopy = JSON.parse(JSON.stringify(containerStepData))
    process.env.GITHUB_WORKSPACE = tmpOutputDir
    containerStepDataCopy.args.dockerfile = 'Dockerfile'
    containerStepDataCopy.args.context = '.'
    console.log(containerStepDataCopy.args)
    await expect(
      runContainerStep(containerStepDataCopy.args, resp.state)
    ).resolves.not.toThrow()
    await expect(cleanupJob()).resolves.not.toThrow()
  })
})
