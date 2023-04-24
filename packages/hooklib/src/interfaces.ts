import * as k8s from '@kubernetes/client-node'

export enum Command {
  PrepareJob = 'prepare_job',
  CleanupJob = 'cleanup_job',
  RunContainerStep = 'run_container_step',
  RunScriptStep = 'run_script_step'
}

export interface HookData {
  command: Command
  responseFile: string
  args?: PrepareJobArgs | RunContainerStepArgs | RunScriptStepArgs
  state?: { [key: string]: any }
}

export interface PrepareJobArgs {
  container?: JobContainerInfo
  services?: ServiceContainerInfo[]
}

export type RunContainerStepArgs = StepContainerInfo

export interface RunScriptStepArgs {
  entryPoint: string
  entryPointArgs: string[]
  environmentVariables?: { [key: string]: string }
  prependPath?: string[]
  workingDirectory: string
}

export interface ContainerInfo {
  image?: string
  entryPoint?: string
  entryPointArgs?: string[]
  createOptions?:
    | string
    | KubernetesJobPodOptions
    | KubernetesServiceContainerOptions
  environmentVariables?: { [key: string]: string }
  userMountVolumes?: Mount[]
  systemMountVolumes?: Mount[]
  registry?: Registry
  portMappings?: string[]
}

export interface KubernetesJobPodOptions {
  activeDeadlineSeconds?: number
  affinity?: k8s.V1Affinity
  automountServiceAccountToken?: boolean
  /**
   * container is a singular word. It only affects the job container
   */
  container: k8s.V1Container
  dnsConfig?: k8s.V1PodDNSConfig
  dnsPolicy?: string
  enableServiceLinks?: boolean
  ephemeralContainers?: k8s.V1EphemeralContainer[]
  hostAliases?: k8s.V1HostAlias[]
  hostIPC?: boolean
  hostNetwork?: boolean
  hostPID?: boolean
  hostUsers?: boolean
  hostname?: string
  imagePullSecrets?: k8s.V1LocalObjectReference[]
  initContainers?: k8s.V1Container[]
  nodeName?: string
  nodeSelector?: {
    [key: string]: string
  }
  os?: k8s.V1PodOS
  overhead?: {
    [key: string]: string
  }
  preemptionPolicy?: string
  priority?: number
  priorityClassName?: string
  readinessGates?: k8s.V1PodReadinessGate[]
  restartPolicy?: string
  runtimeClassName?: string
  schedulerName?: string
  securityContext?: k8s.V1PodSecurityContext
  serviceAccount?: string
  serviceAccountName?: string
  setHostnameAsFQDN?: boolean
  shareProcessNamespace?: boolean
  subdomain?: string
  terminationGracePeriodSeconds?: number
  tolerations?: k8s.V1Toleration[]
  topologySpreadConstraints?: k8s.V1TopologySpreadConstraint[]
  volumes?: k8s.V1Volume[]
}

export interface KubernetesServiceContainerOptions {
  container: k8s.V1Container
}

export interface ServiceContainerInfo extends ContainerInfo {
  contextName: string
  image: string
}

export interface JobContainerInfo extends ContainerInfo {
  image: string
  workingDirectory: string
  systemMountVolumes: Mount[]
}

export interface StepContainerInfo extends ContainerInfo {
  prependPath?: string[]
  workingDirectory: string
  dockerfile?: string
  systemMountVolumes: Mount[]
}

export interface Mount {
  sourceVolumePath: string
  targetVolumePath: string
  readOnly: boolean
}

export interface Registry {
  username?: string
  password?: string
  serverUrl: string
}

export enum Protocol {
  TCP = 'tcp',
  UDP = 'udp'
}

export interface PrepareJobResponse {
  state?: object
  context?: ContainerContext
  services?: { [key: string]: ContainerContext }
  alpine: boolean
}

export interface ContainerContext {
  id?: string
  network?: string
  ports?: { [key: string]: string }
}

export interface ContextPorts {
  [source: string]: string // source -> target
}
