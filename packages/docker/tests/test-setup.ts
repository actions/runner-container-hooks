import * as fs from 'fs'
import { Mount } from 'hooklib'
import { env } from 'process'
import { v4 as uuidv4 } from 'uuid'

export default class TestSetup {
  private testdir: string
  private runnerMockDir: string

  private runnerMockSubdirs = {
    work: '_work',
    externals: 'externals',
    workTemp: '_work/_temp',
    workActions: '_work/_actions',
    workTool: '_work/_tool',
    githubHome: '_work/_temp/_github_home',
    githubWorkflow: '_work/_temp/_github_workflow'
  }
  private readonly projectName = 'test'

  constructor() {
    this.testdir = `${__dirname}/_temp/${uuidv4()}`
    this.runnerMockDir = `${this.testdir}/runner/_layout`
  }

  public initialize(): void {
    for (const dir of this.allTestDirectories) {
      fs.mkdirSync(dir, { recursive: true })
    }
    env.RUNNER_NAME = 'test'
    env.RUNNER_TEMP = `${this.runnerMockDir}/${this.runnerMockSubdirs.workTemp}`
    env.GITHUB_WORKSPACE = this.runnerProjectWorkDir
  }

  public teardown(): void {
    fs.rmdirSync(this.testdir, { recursive: true })
  }

  public get userMountVolumes(): Mount[] {
    return [
      {
        sourceVolumePath: 'my_docker_volume',
        targetVolumePath: '/volume_mount',
        readOnly: false
      }
    ]
  }

  public get runnerProjectWorkDir() {
    return `${this.runnerMockDir}/_work/${this.projectName}/${this.projectName}`
  }

  public get testDir() {
    return this.testdir
  }

  private get allTestDirectories() {
    const resp = [this.testdir, this.runnerMockDir, this.runnerProjectWorkDir]

    for (const [key, value] of Object.entries(this.runnerMockSubdirs)) {
      resp.push(`${this.runnerMockDir}/${value}`)
    }

    return resp
  }

  public get systemMountVolumes(): Mount[] {
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

  public get containerWorkingDirectory(): string {
    return `/__w/${this.projectName}/${this.projectName}`
  }

  public initializeDockerAction(): string {
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
}
