import * as lib from './index.js'
import { chalk } from 'zx'

const commandRunner = (cmd, arg) => {
  if (!cmd) {
    throw new Error(chalk.redBright('No command was entered!'))
  }

  if (!lib[cmd]) {
    throw new Error(chalk.redBright(`404: ${cmd} cmd not found`))
  }

  return new lib[cmd](arg)
}

export { commandRunner }
