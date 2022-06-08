import * as fs from 'fs'
import { prepareJob } from '../src/hooks'
import TestSetup from './test-setup'

jest.useRealTimers()

const prepareJobDefinition = JSON.parse(
  fs.readFileSync(`${__dirname}/../../../examples/prepare-job.json`, 'utf-8')
)

let testSetup: TestSetup

describe('prepare job', () => {
  beforeEach(() => {
    testSetup = new TestSetup()
    testSetup.initialize()

    prepareJobDefinition.args.container.systemMountVolumes =
      testSetup.systemMountVolumes
    prepareJobDefinition.args.container.workingDirectory =
      testSetup.workingDirectory
  })

  afterEach(() => {
    testSetup.teardown()
  })

  it('should not throw', async () => {
    const prepareJobOutput = testSetup.createOutputFile(
      'prepare-job-output.json'
    )
    await expect(
      prepareJob(prepareJobDefinition.args, prepareJobOutput)
    ).resolves.not.toThrow()

    expect(() => fs.readFileSync(prepareJobOutput, 'utf-8')).not.toThrow()
  })

  it('should have JSON output written to a file', async () => {
    const prepareJobOutput = testSetup.createOutputFile(
      'prepare-job-output.json'
    )
    await prepareJob(prepareJobDefinition.args, prepareJobOutput)
    const prepareJobOutputContent = fs.readFileSync(prepareJobOutput, 'utf-8')
    expect(() => JSON.parse(prepareJobOutputContent)).not.toThrow()
  })

  it('should have context written to a file', async () => {
    const prepareJobOutput = testSetup.createOutputFile(
      'prepare-job-output.json'
    )
    await prepareJob(prepareJobDefinition.args, prepareJobOutput)
    const parsedPrepareJobOutput = JSON.parse(
      fs.readFileSync(prepareJobOutput, 'utf-8')
    )
    expect(parsedPrepareJobOutput.context).toBeDefined()
  })

  it('should have container ids written to file', async () => {
    const prepareJobOutput = testSetup.createOutputFile(
      'prepare-job-output.json'
    )
    await prepareJob(prepareJobDefinition.args, prepareJobOutput)
    const prepareJobOutputContent = fs.readFileSync(prepareJobOutput, 'utf-8')
    const parsedPrepareJobOutput = JSON.parse(prepareJobOutputContent)

    expect(parsedPrepareJobOutput.context.container.id).toBeDefined()
    expect(typeof parsedPrepareJobOutput.context.container.id).toBe('string')
    expect(parsedPrepareJobOutput.context.container.id).toMatch(/^[0-9a-f]+$/)
  })

  it('should have ports for context written in form [containerPort]:[hostPort]', async () => {
    const prepareJobOutput = testSetup.createOutputFile(
      'prepare-job-output.json'
    )
    await prepareJob(prepareJobDefinition.args, prepareJobOutput)
    const prepareJobOutputContent = fs.readFileSync(prepareJobOutput, 'utf-8')
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
