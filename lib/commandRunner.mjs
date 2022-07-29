import * as lib from './index.js'
import { chalk } from 'zx'
import yargs from 'yargs'

const commandRunner = (cmd, ...args) => {
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
  for (cmd in lib) {
    if (typeof lib[cmd].yargsCommand === 'object') {
      builder.command(lib[cmd].yargsCommand)
    }
  }

  // normally it would be slice 2 (node, ./gluctl, args), but with zx we needed slice 3 (node, zx, ./gluctl, args)
  // ...but probably need to be smarter about this?
  builder.parse(process.argv.slice(3))
}

export { commandRunner }
