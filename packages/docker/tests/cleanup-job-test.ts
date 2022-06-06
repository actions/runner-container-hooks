import * as fs from 'fs'
import * as path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { cleanupJob, prepareJob } from '../src/hooks'
import TestSetup from './test-setup'

const prepareJobInputPath = path.resolve(
  `${__dirname}/../../../examples/prepare-job.json`
)

const tmpOutputDir = `${__dirname}/${uuidv4()}`

let prepareJobOutputPath: string
let prepareJobData: any

let testSetup: TestSetup

jest.useRealTimers()

describe('cleanup job', () => {
  beforeAll(() => {
    fs.mkdirSync(tmpOutputDir, { recursive: true })
  })

  afterAll(() => {
    fs.rmSync(tmpOutputDir, { recursive: true })
  })

  beforeEach(async () => {
    const prepareJobRawData = fs.readFileSync(prepareJobInputPath, 'utf8')
    prepareJobData = JSON.parse(prepareJobRawData.toString())

    prepareJobOutputPath = `${tmpOutputDir}/prepare-job-output-${uuidv4()}.json`
    fs.writeFileSync(prepareJobOutputPath, '')

    testSetup = new TestSetup()
    testSetup.initialize()

    prepareJobData.args.container.userMountVolumes = testSetup.userMountVolumes
    prepareJobData.args.container.systemMountVolumes =
      testSetup.systemMountVolumes
    prepareJobData.args.container.workingDirectory = testSetup.workingDirectory

    await prepareJob(prepareJobData.args, prepareJobOutputPath)
  })

  afterEach(() => {
    fs.rmSync(prepareJobOutputPath, { force: true })
    testSetup.teardown()
  })

  it('should cleanup successfully', async () => {
    await expect(cleanupJob()).resolves.not.toThrow()
  })
})
