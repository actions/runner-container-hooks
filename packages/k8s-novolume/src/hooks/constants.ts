import { v4 as uuidv4 } from 'uuid'

export function getRunnerPodName(): string {
  const name = process.env.ACTIONS_RUNNER_POD_NAME
  if (!name) {
    throw new Error(
      "'ACTIONS_RUNNER_POD_NAME' env is required, please contact your self hosted runner administrator"
    )
  }
  return name
}

export function getJobPodName(): string {
  return `${getRunnerPodName().substring(
    0,
    MAX_POD_NAME_LENGTH - '-workflow'.length
  )}-workflow`
}

export function getStepPodName(): string {
  return `${getRunnerPodName().substring(
    0,
    MAX_POD_NAME_LENGTH - ('-step-'.length + STEP_POD_NAME_SUFFIX_LENGTH)
  )}-step-${uuidv4().substring(0, STEP_POD_NAME_SUFFIX_LENGTH)}`
}

export function getVolumeClaimName(): string {
  const name = process.env.ACTIONS_RUNNER_CLAIM_NAME
  if (!name) {
    return `${getRunnerPodName()}-work`
  }
  return name
}

export function getSecretName(): string {
  return `${getRunnerPodName().substring(
    0,
    MAX_POD_NAME_LENGTH - ('-secret-'.length + STEP_POD_NAME_SUFFIX_LENGTH)
  )}-secret-${uuidv4().substring(0, STEP_POD_NAME_SUFFIX_LENGTH)}`
}

export const MAX_POD_NAME_LENGTH = 63
export const STEP_POD_NAME_SUFFIX_LENGTH = 8
export const CONTAINER_EXTENSION_PREFIX = '$'
export const JOB_CONTAINER_NAME = 'job'
export const JOB_CONTAINER_EXTENSION_NAME = '$job'

export class RunnerInstanceLabel {
  private podName: string
  constructor() {
    this.podName = getRunnerPodName()
  }

  get key(): string {
    return 'runner-pod'
  }

  get value(): string {
    return this.podName
  }

  toString(): string {
    return `runner-pod=${this.podName}`
  }
}
