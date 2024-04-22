import * as fs from 'fs'
import { WritableStreamBuffer } from 'stream-buffers'
import * as tar from 'tar'
//import { KubeConfig } from './config'
import * as core from '@actions/core'
import { tmpdir } from 'os'
//import { promises as fs, constants as fsConstants } from 'fs';

import * as k8s from '@kubernetes/client-node'
import { randomUUID } from 'crypto'

export class Cp {
  execInstance: k8s.Exec
  constructor(config: k8s.KubeConfig, execInstance?: k8s.Exec) {
    this.execInstance = execInstance || new k8s.Exec(config)
  }

  /**
   * @param {string} namespace - The namespace of the pod to exec the command inside.
   * @param {string} podName - The name of the pod to exec the command inside.
   * @param {string} containerName - The name of the container in the pod to exec the command inside.
   * @param {string} srcPath - The source path in local
   * @param {string} tgtPath - The target path in the pod
   * @param {string} [cwd] - The directory that is used as the parent in the host when uploading
   */
  async cpToPod(
    namespace: string,
    podName: string,
    containerName: string,
    srcPath: string,
    tgtPath: string,
    cwd?: string
  ): Promise<void> {
    const tmpFileName = await this.generateTmpFileName()
    const command = ['tar', 'xf', '-', '-C', tgtPath]

    fs.existsSync(srcPath) ||
      core.error(`Source path ${srcPath} does not exist`)

    core.info(`Archiving ${srcPath} to ${tmpFileName}`)
    await tar.c({ file: tmpFileName, cwd }, [srcPath])

    fs.existsSync(tmpFileName) ||
      core.error(`Tar file ${tmpFileName} does not exist`)

    const readStream = fs.createReadStream(tmpFileName)
    const errStream = new WritableStreamBuffer()
    const stdStream = new WritableStreamBuffer()

    core.info('Exec cpToPod')

    await this.execInstance.exec(
      namespace,
      podName,
      containerName,
      command,
      stdStream,
      errStream,
      readStream,
      false,
      async ({ status }) => {
        core.info(`cpToPod status: ${status}`)
        core.info(`!!! exec stdstream: ${stdStream.getContentsAsString()}`)
        core.info(`!!! exec errstream: ${errStream.getContentsAsString()}`)

        if (status === 'Failure' || errStream.size()) {
          throw new Error(
            `Error from cpToPod - details: \n ${errStream.getContentsAsString()}`
          )
        }
      }
    )

    core.info('Exec cpToPod done')
  }

  async generateTmpFileName(): Promise<string> {
    let tmpFileName: string

    let i = 0
    do {
      tmpFileName = `${tmpdir()}/${randomUUID()}`

      core.info(`Checking if tmp file ${tmpFileName} exists`)

      try {
        await fs.promises.access(tmpFileName, fs.constants.W_OK)

        core.info('Tmp file already exists')
      } catch (err) {
        core.info(
          `Tmp file does not exist. We figured out that by error : ${err}`
        )
        return tmpFileName
      }
      i++
    } while (i < 10)

    throw new Error('Cannot generate tmp file name')
  }
}
