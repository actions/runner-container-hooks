import * as fs from 'fs'
import { cleanupJob } from '../src/hooks'
import { prepareJob } from '../src/hooks/prepare-job'
import { TestHelper } from './test-setup'
import { getPodByName } from '../src/k8s'
import { ENV_HOOK_RWO } from '../src/k8s/utils'

jest.useRealTimers()

let testHelper: TestHelper
let prepareJobData: any
let prepareJobOutputFilePath: string

describe('RWO Affinity Behavior', () => {
  beforeEach(async () => {
    testHelper = new TestHelper()
    await testHelper.initialize()
    prepareJobData = testHelper.getPrepareJobDefinition()
    prepareJobOutputFilePath = testHelper.createFile('prepare-job-output.json')
  })

  afterEach(async () => {
    await cleanupJob()
    await testHelper.cleanup()
    delete process.env[ENV_HOOK_RWO]
  })

  it('should add preferred nodeAffinity with hostname selector by default', async () => {
    await prepareJob(prepareJobData.args, prepareJobOutputFilePath)

    const content = JSON.parse(
      fs.readFileSync(prepareJobOutputFilePath).toString()
    )

    const pod = await getPodByName(content.state.jobPod)

    expect(pod.spec?.affinity).toBeDefined()
    expect(pod.spec?.affinity?.nodeAffinity).toBeDefined()

    const nodeAffinity = pod.spec?.affinity?.nodeAffinity
    expect(
      nodeAffinity?.preferredDuringSchedulingIgnoredDuringExecution
    ).toBeDefined()

    const preferred =
      nodeAffinity?.preferredDuringSchedulingIgnoredDuringExecution

    expect(preferred).toBeDefined()
    expect(preferred?.length).toBeGreaterThan(0)
    expect(preferred?.[0]?.weight).toBe(100)

    const matchExpressions = preferred?.[0]?.preference?.matchExpressions
    expect(matchExpressions).toBeDefined()
    expect(matchExpressions?.length).toBeGreaterThan(0)

    const hostnameExpression = matchExpressions?.[0]
    expect(hostnameExpression?.key).toBe('kubernetes.io/hostname')
    expect(hostnameExpression?.operator).toBe('In')

    expect(hostnameExpression?.values).toBeDefined()
    expect(hostnameExpression?.values?.length).toBeGreaterThan(0)
    expect(hostnameExpression?.values?.[0]).toBeTruthy()
  })

  it('should add required nodeAffinity when ACTIONS_RUNNER_HOOK_RWO=true', async () => {
    process.env[ENV_HOOK_RWO] = 'true'

    await prepareJob(prepareJobData.args, prepareJobOutputFilePath)

    const content = JSON.parse(
      fs.readFileSync(prepareJobOutputFilePath).toString()
    )

    const pod = await getPodByName(content.state.jobPod)

    expect(pod.spec?.affinity).toBeDefined()
    expect(pod.spec?.affinity?.nodeAffinity).toBeDefined()
    expect(
      pod.spec?.affinity?.nodeAffinity
        ?.requiredDuringSchedulingIgnoredDuringExecution
    ).toBeDefined()
    expect(
      pod.spec?.affinity?.nodeAffinity
        ?.preferredDuringSchedulingIgnoredDuringExecution
    ).toBeUndefined()

    const requiredValues =
      pod.spec?.affinity?.nodeAffinity
        ?.requiredDuringSchedulingIgnoredDuringExecution?.nodeSelectorTerms?.[0]
        ?.matchExpressions?.[0]?.values

    expect(requiredValues).toBeDefined()
    expect(requiredValues?.length).toBeGreaterThan(0)
  })

  it('should not require node affinity by default', async () => {
    await prepareJob(prepareJobData.args, prepareJobOutputFilePath)

    const content = JSON.parse(
      fs.readFileSync(prepareJobOutputFilePath).toString()
    )

    const pod = await getPodByName(content.state.jobPod)

    expect(pod.spec?.affinity).toBeDefined()
    expect(pod.spec?.affinity?.nodeAffinity).toBeDefined()
    expect(
      pod.spec?.affinity?.nodeAffinity
        ?.requiredDuringSchedulingIgnoredDuringExecution
    ).toBeUndefined()

    const preferred =
      pod.spec?.affinity?.nodeAffinity
        ?.preferredDuringSchedulingIgnoredDuringExecution

    expect(preferred?.[0]?.preference?.matchExpressions?.[0]?.key).toBe(
      'kubernetes.io/hostname'
    )
    expect(preferred?.[0]?.preference?.matchExpressions?.[0]?.operator).toBe(
      'In'
    )
    expect(
      preferred?.[0]?.preference?.matchExpressions?.[0]?.values?.length
    ).toBeGreaterThan(0)
  })

  it('should use correct runner node name in preferred affinity values by default', async () => {
    const runnerPodName = process.env.ACTIONS_RUNNER_POD_NAME

    await prepareJob(prepareJobData.args, prepareJobOutputFilePath)

    const content = JSON.parse(
      fs.readFileSync(prepareJobOutputFilePath).toString()
    )

    const jobPod = await getPodByName(content.state.jobPod)

    const runnerPod = await getPodByName(runnerPodName!)

    const affinityValues =
      jobPod.spec?.affinity?.nodeAffinity
        ?.preferredDuringSchedulingIgnoredDuringExecution?.[0]?.preference
        ?.matchExpressions?.[0]?.values

    expect(affinityValues).toBeDefined()
    expect(affinityValues?.length).toBeGreaterThan(0)

    if (runnerPod.spec?.nodeName) {
      expect(affinityValues).toContain(runnerPod.spec.nodeName)
    }
  })
})
