import { $, YAML, chalk } from 'zx'

class Snapshot {
  constructor (argv) {
    this.argv = argv
    this.app = argv.app || argv.a || process.env.APP
    this.namespace = argv.namespace || argv.n || process.env.NAMESPACE
    this.kopiaApp = argv['kopia-app'] || process.env.KOPIA_APP || 'kopia'
    this.kopiaNamespace = argv['kopia-namespace'] || process.env.KOPIA_NAMESPACE || 'default'

    if (!this.app) {
      return console.error('Error: ' + chalk.redBright('Argument --app, -a or env APP not set'))
    }
    if (!this.namespace) {
      return console.error('Error: ' + chalk.redBright('Argument --namespace, -n or env NAMESPACE not set'))
    }

    switch (argv.action) {
      case 'list':
        this.list()
        break
      case 'create':
        this.create()
        break
      default:
        console.error('404: ' + chalk.redBright(`${argv.action} arg not found`))
        break
    }
  }

  static yargsCommand = {
    command: 'snapshot <action>',
    desc: 'Manage snapshots',
    strictCommands: true,
    builder: (yargs) => yargs
      .positional('action', {
        choices: ['create', 'list']
      })
      .option('app', {
        alias: ['a'],
        demandOption: true,
        type: 'string',
        desc: 'The app'
      })
      .option('namespace', {
        alias: ['n'],
        demandOption: true,
        type: 'string',
        desc: 'The namespace for the snapshot'
      })
      .option('kopia-app', {
        type: 'string',
        desc: 'The name of the kopia app',
        default: 'kopia'
      })
      .option('kopia-namespace', {
        type: 'string',
        desc: 'The namespace of kopia',
        default: 'default'
      }),
    handler: (argv) => {
      return new Snapshot(argv)
    }
  }

  async list () {
    const snapshots = await $`kubectl -n ${this.kopiaNamespace} exec -it deployment/${this.kopiaApp} -- kopia snapshot list /data/${this.namespace}/${this.app} --json`
    const structData = []
    for (const obj of JSON.parse(snapshots.stdout)) {
      const latest = obj.retentionReason.includes('latest-1')
      structData.push({
        'snapshot id': obj.id,
        'date created': obj.startTime,
        latest
      })
    }
    console.table(structData)
  }

  async create () {
    const jobRaw = await $`kubectl -n ${this.namespace} create job --from=cronjob/${this.app}-snapshot ${this.app}-snapshot-${+new Date()} --dry-run=client --output json`
    const jobJson = JSON.parse(jobRaw.stdout)
    delete jobJson.spec.template.spec.initContainers
    const jobYaml = new YAML.Document()
    jobYaml.contents = jobJson
    await $`echo ${jobYaml.toString()}`.pipe($`kubectl apply -f -`)
  }
}

export { Snapshot }
