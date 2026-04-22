import * as fs from 'fs'
import { cleanupJob } from '../src/hooks'
import { prepareJob } from '../src/hooks/prepare-job'
import { TestHelper } from './test-setup'
import { getPodByName } from '../src/k8s'
import { ENV_DISABLE_KUBE_SCHEDULER } from '../src/k8s/utils'

jest.useRealTimers()

let testHelper: TestHelper
let prepareJobData: any
let prepareJobOutputFilePath: string

describe('RWO Affinity Behavior (Scheduler Mode)', () => {
  beforeEach(async () => {
    testHelper = new TestHelper()
    await testHelper.initialize()
    prepareJobData = testHelper.getPrepareJobDefinition()
    prepareJobOutputFilePath = testHelper.createFile('prepare-job-output.json')
  })

  afterEach(async () => {
    await cleanupJob()
    await testHelper.cleanup()
    delete process.env[ENV_DISABLE_KUBE_SCHEDULER]
  })

  it('should add nodeAffinity with hostname selector by default', async () => {
    await prepareJob(prepareJobData.args, prepareJobOutputFilePath)

    const content = JSON.parse(
      fs.readFileSync(prepareJobOutputFilePath).toString()
    )

    const pod = await getPodByName(content.state.jobPod)

    expect(pod.spec?.affinity).toBeDefined()
    expect(pod.spec?.affinity?.nodeAffinity).toBeDefined()

    const nodeAffinity = pod.spec?.affinity?.nodeAffinity
    expect(
      nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution
    ).toBeDefined()

    const nodeSelectorTerms =
      nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution
        ?.nodeSelectorTerms

    expect(nodeSelectorTerms).toBeDefined()
    expect(nodeSelectorTerms?.length).toBeGreaterThan(0)

    const matchExpressions = nodeSelectorTerms?.[0].matchExpressions
    expect(matchExpressions).toBeDefined()
    expect(matchExpressions?.length).toBeGreaterThan(0)

    const hostnameExpression = matchExpressions?.[0]
    expect(hostnameExpression?.key).toBe('kubernetes.io/hostname')
    expect(hostnameExpression?.operator).toBe('In')

    expect(hostnameExpression?.values).toBeDefined()
    expect(hostnameExpression?.values?.length).toBeGreaterThan(0)
    expect(hostnameExpression?.values?.[0]).toBeTruthy()
  })

  it('should NOT add nodeAffinity when scheduler mode is disabled', async () => {
    process.env[ENV_DISABLE_KUBE_SCHEDULER] = 'true'

    await prepareJob(prepareJobData.args, prepareJobOutputFilePath)

    const content = JSON.parse(
      fs.readFileSync(prepareJobOutputFilePath).toString()
    )

    const pod = await getPodByName(content.state.jobPod)

    if (pod.spec?.affinity) {
      expect(pod.spec.affinity.nodeAffinity).toBeUndefined()
    }

    expect(pod.spec?.nodeName).toBeDefined()
  })

  it('should fail assertion if affinity block is missing by default', async () => {
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

    const nodeSelectorTerms =
      pod.spec?.affinity?.nodeAffinity
        ?.requiredDuringSchedulingIgnoredDuringExecution?.nodeSelectorTerms

    expect(nodeSelectorTerms?.[0]?.matchExpressions?.[0]?.key).toBe(
      'kubernetes.io/hostname'
    )
    expect(nodeSelectorTerms?.[0]?.matchExpressions?.[0]?.operator).toBe('In')
    expect(
      nodeSelectorTerms?.[0]?.matchExpressions?.[0]?.values?.length
    ).toBeGreaterThan(0)
  })

  it('should use correct node name from runner pod in affinity values by default', async () => {
    const runnerPodName = process.env.ACTIONS_RUNNER_POD_NAME

    await prepareJob(prepareJobData.args, prepareJobOutputFilePath)

    const content = JSON.parse(
      fs.readFileSync(prepareJobOutputFilePath).toString()
    )

    const jobPod = await getPodByName(content.state.jobPod)

    const runnerPod = await getPodByName(runnerPodName!)

    const affinityValues =
      jobPod.spec?.affinity?.nodeAffinity
        ?.requiredDuringSchedulingIgnoredDuringExecution?.nodeSelectorTerms?.[0]
        ?.matchExpressions?.[0]?.values

    expect(affinityValues).toBeDefined()
    expect(affinityValues?.length).toBeGreaterThan(0)

    if (runnerPod.spec?.nodeName) {
      expect(affinityValues).toContain(runnerPod.spec.nodeName)
    }
  })
})
