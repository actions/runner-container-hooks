import * as fs from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { prepareJob } from '../src/hooks'
import TestSetup from './test-setup'

jest.useRealTimers()

let prepareJobOutputPath: string
let prepareJobData: any
const tmpOutputDir = `${__dirname}/_temp/${uuidv4()}`
const prepareJobInputPath = `${__dirname}/../../../examples/prepare-job.json`

let testSetup: TestSetup

describe('prepare job', () => {
  beforeAll(() => {
    fs.mkdirSync(tmpOutputDir, { recursive: true })
  })

  afterAll(() => {
    fs.rmSync(tmpOutputDir, { recursive: true })
  })

  beforeEach(async () => {
    testSetup = new TestSetup()
    testSetup.initialize()

    let prepareJobRawData = fs.readFileSync(prepareJobInputPath, 'utf8')
    prepareJobData = JSON.parse(prepareJobRawData.toString())

    prepareJobData.args.container.userMountVolumes = testSetup.userMountVolumes
    prepareJobData.args.container.systemMountVolumes =
      testSetup.systemMountVolumes
    prepareJobData.args.container.workingDirectory = testSetup.workingDirectory

    prepareJobOutputPath = `${tmpOutputDir}/prepare-job-output-${uuidv4()}.json`
    fs.writeFileSync(prepareJobOutputPath, '')
  })

  afterEach(() => {
    testSetup.teardown()
  })

  it('should not throw', async () => {
    await expect(
      prepareJob(prepareJobData.args, prepareJobOutputPath)
    ).resolves.not.toThrow()

    expect(() => fs.readFileSync(prepareJobOutputPath, 'utf-8')).not.toThrow()
  })

  it('should have JSON output written to a file', async () => {
    await prepareJob(prepareJobData.args, prepareJobOutputPath)
    const prepareJobOutputContent = fs.readFileSync(
      prepareJobOutputPath,
      'utf-8'
    )
    expect(() => JSON.parse(prepareJobOutputContent)).not.toThrow()
  })

  it('should have context written to a file', async () => {
    await prepareJob(prepareJobData.args, prepareJobOutputPath)
    const prepareJobOutputContent = fs.readFileSync(
      prepareJobOutputPath,
      'utf-8'
    )
    const parsedPrepareJobOutput = JSON.parse(prepareJobOutputContent)
    expect(parsedPrepareJobOutput.context).toBeDefined()
  })

  it('should have container ids written to file', async () => {
    await prepareJob(prepareJobData.args, prepareJobOutputPath)
    const prepareJobOutputContent = fs.readFileSync(
      prepareJobOutputPath,
      'utf-8'
    )
    const parsedPrepareJobOutput = JSON.parse(prepareJobOutputContent)

    expect(parsedPrepareJobOutput.context.container.id).toBeDefined()
    expect(typeof parsedPrepareJobOutput.context.container.id).toBe('string')
    expect(parsedPrepareJobOutput.context.container.id).toMatch(/^[0-9a-f]+$/)
  })

  it('should have ports for context written in form [containerPort]:[hostPort]', async () => {
    await prepareJob(prepareJobData.args, prepareJobOutputPath)
    const prepareJobOutputContent = fs.readFileSync(
      prepareJobOutputPath,
      'utf-8'
    )
    const parsedPrepareJobOutput = JSON.parse(prepareJobOutputContent)

    const mainContainerPorts = parsedPrepareJobOutput.context.container.ports
    expect(mainContainerPorts['8080']).toBe('80')

    const redisService = parsedPrepareJobOutput.context.services.find(
      s => s.image === 'redis'
    )

    const redisServicePorts = redisService.ports
    expect(redisServicePorts['80']).toBe('8080')
    expect(redisServicePorts['8080']).toBe('8088')
  })
})
