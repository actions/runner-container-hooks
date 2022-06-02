import * as fs from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { env } from 'process'
import { Mount } from 'hooklib'

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

  private readonly projectName = 'example'

  constructor() {
    this.testdir = `${__dirname}/_temp/${uuidv4()}`
    this.runnerMockDir = `${this.testdir}/runner/_layout`
  }

  private get allTestDirectories() {
    const resp = [this.testdir, this.runnerMockDir]

    for (const [key, value] of Object.entries(this.runnerMockSubdirs)) {
      resp.push(`${this.runnerMockDir}/${value}`)
    }

    resp.push(
      `${this.runnerMockDir}/_work/${this.projectName}/${this.projectName}`
    )

    return resp
  }

  public initialize(): void {
    for (const dir of this.allTestDirectories) {
      fs.mkdirSync(dir, { recursive: true })
    }
    env['RUNNER_NAME'] = 'test'
    env[
      'RUNNER_TEMP'
    ] = `${this.runnerMockDir}/${this.runnerMockSubdirs.workTemp}`
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

  public get workingDirectory(): string {
    return `/__w/${this.projectName}/${this.projectName}`
  }
}
