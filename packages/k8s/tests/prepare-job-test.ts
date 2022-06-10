import * as fs from 'fs'
import * as path from 'path'
import { cleanupJob } from '../src/hooks'
import { prepareJob } from '../src/hooks/prepare-job'
import { TestHelper } from './test-setup'

jest.useRealTimers()

let testHelper: TestHelper

const prepareJobJsonPath = path.resolve(
  `${__dirname}/../../../examples/prepare-job.json`
)
let prepareJobData: any

let prepareJobOutputFilePath: string

describe('Prepare job', () => {
  beforeEach(async () => {
    const prepareJobJson = fs.readFileSync(prepareJobJsonPath)
    prepareJobData = JSON.parse(prepareJobJson.toString())

    testHelper = new TestHelper()
    await testHelper.initialize()
    prepareJobOutputFilePath = testHelper.createFile('prepare-job-output.json')
  })
  afterEach(async () => {
    await cleanupJob()
    await testHelper.cleanup()
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

  it('should prepare job with absolute path for userVolumeMount', async () => {
    prepareJobData.args.container.userMountVolumes.forEach(v => {
      if (!path.isAbsolute(v.sourceVolumePath)) {
        v.sourceVolumePath = path.join(
          process.env.GITHUB_WORKSPACE as string,
          v.sourceVolumePath
        )
      }
    })
    await expect(
      prepareJob(prepareJobData.args, prepareJobOutputFilePath)
    ).resolves.not.toThrow()
  })

  it('should throw an exception if the user volume mount is absolute path outside of GITHUB_WORKSPACE', async () => {
    prepareJobData.args.container.userMountVolumes.forEach(v => {
      if (!path.isAbsolute(v.sourceVolumePath)) {
        v.sourceVolumePath = path.join(
          '/path/outside/of/github-workspace',
          v.sourceVolumePath
        )
      }
    })
    await expect(
      prepareJob(prepareJobData.args, prepareJobOutputFilePath)
    ).rejects.toThrow()
  })
})
