import * as k8s from '@kubernetes/client-node'
import { cleanupJob, prepareJob, runContainerStep } from '../src/hooks'
import { RunnerInstanceLabel } from '../src/hooks/constants'
import { namespace } from '../src/k8s'
import { TestHelper } from './test-setup'
import { PrepareJobArgs } from 'hooklib'

let testHelper: TestHelper

describe('Cleanup Job', () => {
  beforeEach(async () => {
    testHelper = new TestHelper()
    await testHelper.initialize()
    let prepareJobData = testHelper.getPrepareJobDefinition()
    const prepareJobOutputFilePath = testHelper.createFile(
      'prepare-job-output.json'
    )
    await prepareJob(
      prepareJobData.args as PrepareJobArgs,
      prepareJobOutputFilePath
    )
  })

  afterEach(async () => {
    await testHelper.cleanup()
  })

  it('should not throw', async () => {
    await expect(cleanupJob()).resolves.not.toThrow()
  })

  it('should have no runner linked pods running', async () => {
    await cleanupJob()
    const kc = new k8s.KubeConfig()

    kc.loadFromDefault()
    const k8sApi = kc.makeApiClient(k8s.CoreV1Api)

    const podList = await k8sApi.listNamespacedPod({
      namespace: namespace(),
      labelSelector: new RunnerInstanceLabel().toString()
    })

    expect(podList.items.length).toBe(0)
  })

  it('should have no runner linked secrets', async () => {
    await cleanupJob()
    const kc = new k8s.KubeConfig()

    kc.loadFromDefault()
    const k8sApi = kc.makeApiClient(k8s.CoreV1Api)

    const secretList = await k8sApi.listNamespacedSecret({
      namespace: namespace(),
      labelSelector: new RunnerInstanceLabel().toString()
    })

    expect(secretList.items.length).toBe(0)
  })
})

describe('cleanup job removes step jobs', () => {
  let helper: TestHelper
  let stepData: any

  const clients = (): {
    core: k8s.CoreV1Api
    batch: k8s.BatchV1Api
  } => {
    const kc = new k8s.KubeConfig()
    kc.loadFromDefault()
    return {
      core: kc.makeApiClient(k8s.CoreV1Api),
      batch: kc.makeApiClient(k8s.BatchV1Api)
    }
  }

  beforeEach(async () => {
    helper = new TestHelper()
    await helper.initialize()
    const prepareJobData = helper.getPrepareJobDefinition()
    const outputPath = helper.createFile('prepare-job-output.json')
    await prepareJob(prepareJobData.args as PrepareJobArgs, outputPath)
    stepData = helper.getRunContainerStepDefinition()
  })

  afterEach(async () => {
    await cleanupJob()
    await helper.cleanup()
  })

  it('should label the pod created by the step job', async () => {
    await runContainerStep(stepData.args)

    const { core } = clients()
    const pods = await core.listNamespacedPod({
      namespace: namespace(),
      labelSelector: new RunnerInstanceLabel().toString()
    })

    // without a label on spec.template.metadata the step pod carries no
    // runner label and is invisible to prunePods()
    const stepPods = pods.items.filter(p =>
      p.metadata?.ownerReferences?.some(o => o.kind === 'Job')
    )
    expect(stepPods.length).toBeGreaterThan(0)
  })

  it('should delete the step job on cleanup', async () => {
    await runContainerStep(stepData.args)

    const { batch } = clients()
    const labelSelector = new RunnerInstanceLabel().toString()

    const before = await batch.listNamespacedJob({
      namespace: namespace(),
      labelSelector
    })
    expect(before.items.length).toBeGreaterThan(0)

    await cleanupJob()

    // Jobs were previously left to ttlSecondsAfterFinished, which never
    // fires for a job that does not finish
    const after = await batch.listNamespacedJob({
      namespace: namespace(),
      labelSelector
    })
    const remaining = after.items.filter(j => !j.metadata?.deletionTimestamp)
    expect(remaining).toHaveLength(0)
  })
})
