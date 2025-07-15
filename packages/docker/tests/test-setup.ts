import * as fs from 'fs'
import { Mount } from 'hooklib'
import { HookData } from 'hooklib/lib'
import * as path from 'path'
import { env } from 'process'
import { v4 as uuidv4 } from 'uuid'

export default class TestSetup {
  private testdir: string
  private runnerMockDir: string
  readonly runnerOutputDir: string

  private runnerMockSubdirs = {
    work: '_work',
    externals: 'externals',
    workTemp: '_work/_temp',
    workActions: '_work/_actions',
    workTool: '_work/_tool',
    githubHome: '_work/_temp/_github_home',
    githubWorkflow: '_work/_temp/_github_workflow'
  }

  private readonly projectName = 'repo'

  constructor() {
    this.testdir = `${__dirname}/_temp/${uuidv4()}`
    this.runnerMockDir = `${this.testdir}/runner/_layout`
    this.runnerOutputDir = `${this.testdir}/outputs`
  }

  private get allTestDirectories() {
    const resp = [this.testdir, this.runnerMockDir, this.runnerOutputDir]

    for (const [, value] of Object.entries(this.runnerMockSubdirs)) {
      resp.push(`${this.runnerMockDir}/${value}`)
    }

    resp.push(
      `${this.runnerMockDir}/_work/${this.projectName}/${this.projectName}`
    )

    return resp
  }

  initialize(): void {
    env['GITHUB_WORKSPACE'] = this.workingDirectory
    env['RUNNER_NAME'] = 'test'
    env['RUNNER_TEMP'] =
      `${this.runnerMockDir}/${this.runnerMockSubdirs.workTemp}`

    for (const dir of this.allTestDirectories) {
      fs.mkdirSync(dir, { recursive: true })
    }

    fs.copyFileSync(
      path.resolve(`${__dirname}/../../../examples/example-script.sh`),
      `${env.RUNNER_TEMP}/example-script.sh`
    )
  }

  teardown(): void {
    fs.rmdirSync(this.testdir, { recursive: true })
  }

  private get systemMountVolumes(): Mount[] {
    return [
      {
        sourceVolumePath: '/var/run/docker.sock',
        targetVolumePath: '/var/run/docker.sock',
        readOnly: false
      },
      {
        sourceVolumePath: `${this.runnerMockDir}/${this.runnerMockSubdirs.work}`,
        targetVolumePath: '/__w',
        readOnly: false
      },
      {
        sourceVolumePath: `${this.runnerMockDir}/${this.runnerMockSubdirs.externals}`,
        targetVolumePath: '/__e',
        readOnly: true
      },
      {
        sourceVolumePath: `${this.runnerMockDir}/${this.runnerMockSubdirs.workTemp}`,
        targetVolumePath: '/__w/_temp',
        readOnly: false
      },
      {
        sourceVolumePath: `${this.runnerMockDir}/${this.runnerMockSubdirs.workActions}`,
        targetVolumePath: '/__w/_actions',
        readOnly: false
      },
      {
        sourceVolumePath: `${this.runnerMockDir}/${this.runnerMockSubdirs.workTool}`,
        targetVolumePath: '/__w/_tool',
        readOnly: false
      },
      {
        sourceVolumePath: `${this.runnerMockDir}/${this.runnerMockSubdirs.githubHome}`,
        targetVolumePath: '/github/home',
        readOnly: false
      },
      {
        sourceVolumePath: `${this.runnerMockDir}/${this.runnerMockSubdirs.githubWorkflow}`,
        targetVolumePath: '/github/workflow',
        readOnly: false
      }
    ]
  }

  createOutputFile(name: string): string {
    let filePath = path.join(this.runnerOutputDir, name || `${uuidv4()}.json`)
    fs.writeFileSync(filePath, '')
    return filePath
  }

  get workingDirectory(): string {
    return `${this.runnerMockDir}/_work/${this.projectName}/${this.projectName}`
  }

  get containerWorkingDirectory(): string {
    return `/__w/${this.projectName}/${this.projectName}`
  }

  initializeDockerAction(): string {
    const actionPath = `${this.testdir}/_actions/example-handle/example-repo/example-branch/mock-directory`
    fs.mkdirSync(actionPath, { recursive: true })
    this.writeDockerfile(actionPath)
    this.writeEntrypoint(actionPath)
    return actionPath
  }

  private writeDockerfile(actionPath: string) {
    const content = `FROM alpine:3.10
COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]`
    fs.writeFileSync(`${actionPath}/Dockerfile`, content)
  }

  private writeEntrypoint(actionPath) {
    const content = `#!/bin/sh -l
echo "Hello $1"
time=$(date)
echo "::set-output name=time::$time"`
    const entryPointPath = `${actionPath}/entrypoint.sh`
    fs.writeFileSync(entryPointPath, content)
    fs.chmodSync(entryPointPath, 0o755)
  }

  getPrepareJobDefinition(): HookData {
    const prepareJob = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname + '/../../../examples/prepare-job.json'),
        'utf8'
      )
    )

    prepareJob.args.container.systemMountVolumes = this.systemMountVolumes
    prepareJob.args.container.workingDirectory = this.workingDirectory
    prepareJob.args.container.userMountVolumes = undefined
    prepareJob.args.container.registry = null
    prepareJob.args.services.forEach(s => {
      s.registry = null
    })

    return prepareJob
  }

  getRunScriptStepDefinition(): HookData {
    const runScriptStep = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname + '/../../../examples/run-script-step.json'),
        'utf8'
      )
    )

    runScriptStep.args.entryPointArgs[1] = `/__w/_temp/example-script.sh`
    return runScriptStep
  }

  getRunContainerStepDefinition(): HookData {
    const runContainerStep = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname + '/../../../examples/run-container-step.json'),
        'utf8'
      )
    )

    runContainerStep.args.entryPointArgs[1] = `/__w/_temp/example-script.sh`
    runContainerStep.args.systemMountVolumes = this.systemMountVolumes
    runContainerStep.args.workingDirectory = this.workingDirectory
    runContainerStep.args.userMountVolumes = undefined
    runContainerStep.args.registry = null
    return runContainerStep
  }
}
