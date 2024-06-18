import * as fs from 'fs'
import { WritableStreamBuffer } from 'stream-buffers'
import * as tar from 'tar'
import * as core from '@actions/core'
import { tmpdir } from 'os'
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
    // Generate a temporary file for the tar archive.
    const tmpFileName = await this.generateTmpFileName()
    const command = ['tar', 'xf', '-', '-C', tgtPath]

    core.debug(`Archiving ${srcPath} to ${tmpFileName}`)
    await tar.c({ file: tmpFileName, cwd }, [srcPath])

    // Ensure the tar file exists.
    if (!fs.existsSync(tmpFileName)) {
      core.error(`Tar file ${tmpFileName} does not exist`)
      throw new Error(`Tar file ${tmpFileName} does not exist`)
    }

    // Get the file size for logging purposes.
    const stats = fs.statSync(tmpFileName)
    const fileSizeInBytes = stats.size
    core.debug(`Transferring: ${fileSizeInBytes.toLocaleString()} Bytes`)

    const readStream = fs.createReadStream(tmpFileName)
    const errStream = new WritableStreamBuffer()
    const stdStream = new WritableStreamBuffer()

    core.debug('Exec cpToPod')

    // Refactor this part to wait for the status in the callback
    return await new Promise<void>(async (resolve, reject) => {
      ;(
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
            // this never happens
            core.debug(`cpToPod status: ${status}`)
            core.debug(`!!! exec stdstream: ${stdStream.getContentsAsString()}`)
            core.debug(`!!! exec errstream: ${errStream.getContentsAsString()}`)

            if (status === 'Failure' || errStream.size()) {
              reject(
                new Error(
                  `Error from cpToPod - details: \n ${errStream.getContentsAsString()}`
                )
              )
            } else {
              resolve()
            }
          }
        )
      ).addEventListener('close', () => {
        core.debug('Done copying files to pod')
        // Possible rejection or resolution based on additional logic (e.g., checking if a resolution or rejection already occurred).
        core.debug(`!!! exec std stream: ${stdStream.getContentsAsString()}`)
        core.debug(`!!! exec err stream: ${errStream.getContentsAsString()}`)
        resolve()
      })
    })
  }

  async generateTmpFileName(): Promise<string> {
    let tmpFileName: string

    let i = 0
    do {
      tmpFileName = `${tmpdir()}/${randomUUID()}`

      core.debug(`Checking if tmp file ${tmpFileName} exists`)

      try {
        await fs.promises.access(tmpFileName, fs.constants.W_OK)
        core.debug('Tmp file already exists')
      } catch (err) {
        return tmpFileName
      }
      i++
    } while (i < 10)

    throw new Error('Cannot generate tmp file name')
  }
}
