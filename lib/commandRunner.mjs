import * as lib from './index.js'
import { chalk } from 'zx'

const commandRunner = (cmd, ...args) => {
  if (!cmd) {
    return console.error('Error: ' + chalk.redBright('No command was entered'))
  }

  if (!lib[cmd]) {
    return console.error('404: ' + chalk.redBright(`${cmd} cmd not found`))
  }

  return new lib[cmd](...args)
}

export { commandRunner }
