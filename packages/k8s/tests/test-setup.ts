import * as fs from 'fs'
import { v4 as uuidv4 } from 'uuid'

export class TestTempOutput {
  private tempDirPath: string
  constructor() {
    this.tempDirPath = `${__dirname}/_temp/${uuidv4()}`
  }

  public initialize(): void {
    fs.mkdirSync(this.tempDirPath, { recursive: true })
  }

  public cleanup(): void {
    fs.rmSync(this.tempDirPath, { recursive: true })
  }

  public createFile(fileName?: string): string {
    const filePath = `${this.tempDirPath}/${fileName || uuidv4()}`
    fs.writeFileSync(filePath, '')
    return filePath
  }

  public removeFile(fileName: string): void {
    const filePath = `${this.tempDirPath}/${fileName}`
    fs.rmSync(filePath)
  }
}
