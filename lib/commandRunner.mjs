import * as lib from './index.js'
import { chalk } from 'zx'
import yargs from 'yargs'

const commandRunner = async (cmd, ...args) => {
  const builder = yargs()
    .scriptName('gluctl')
    .usage('$0 <cmd> [args]')
    // enable parsing env vars (no prefix specified)
    .env()
    // error out when no command is given
    .demandCommand(1, 'No command was entered')
    // error out when given an unnknown command
    .strictCommands()
    // enable help menus
    .help()
    // enable shorthand help argument
    .alias('help', 'h')
    // enable completion
    .completion()
    // customize failure message to add some color
    .fail((msg, err, yargs) => {
      if (err) throw err // preserve stack
      console.error(yargs.help(), '\n')
      console.error(chalk.redBright(msg))
      process.exit(1)
    })

  // iterate over lib and add the commands
  let libCmd
  for (libCmd in lib) {
    if (typeof lib[libCmd].yargsCommand === 'object') {
      builder.command(lib[libCmd].yargsCommand)
    }
  }

  builder.parse([cmd, ...args])
}

export { commandRunner }
