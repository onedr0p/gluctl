import * as lib from './index.js'
import { chalk } from 'zx'

const commandRunner = (cmd, ...args) => {
  if (!cmd) {
    throw new Error(chalk.redBright('No command was entered!'))
  }

  if (!lib[cmd]) {
    throw new Error(chalk.redBright(`404: ${cmd} cmd not found`))
  }

  return new lib[cmd](...args)
}

export { commandRunner }
