import { $, chalk, echo, sleep } from 'zx'

class Snapshot {
  constructor (argv) {
    this.argv = argv
    this.app = argv.app
    this.claim = argv.claim
    this.namespace = argv.namespace
    this.snapshot = argv.snapshot
    this.timeout = argv.timeout
    this.kopiaApp = argv.kopiaApp
    this.kopiaNamespace = argv.kopiaNamespace

    switch (argv.action) {
      case 'list':
        this.list()
        break
      case 'create':
        this.create()
        break
      case 'restore':
        this.restore()
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
        choices: ['create', 'list', 'restore']
      })
      .option('app', {
        alias: ['a'],
        demandOption: true,
        type: 'string',
        desc: 'The app for the snapshot'
      })
      .option('claim', {
        alias: ['c'],
        demandOption: true,
        type: 'string',
        desc: 'The PersistentVolumeClaim to snapshot'
      })
      .option('namespace', {
        alias: ['n'],
        demandOption: true,
        type: 'string',
        desc: 'The namespace for the snapshot',
        default: 'default'
      })
      .option('snapshot', {
        alias: ['s'],
        type: 'string',
        desc: 'The snapshot id (or "latest")',
        default: 'latest'
      })
      .option('timeout', {
        alias: ['t'],
        type: 'string',
        desc: 'The timeout for long running processes',
        default: '60m'
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

  /*
  List all snapshots for an app
  */
  async list () {
    const snapshots = await $`kubectl -n ${this.kopiaNamespace} exec -it deployment/${this.kopiaApp} -- kopia snapshot list /data/${this.namespace}/${this.app}/${this.claim} --json`
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

  /*
  Create a snapshot of an app
  */
  async create () {
    const jobProcess = await $`kubectl -n ${this.namespace} create job --from=cronjob/${this.app}-${this.claim}-snapshot ${this.app}-${this.claim}-snapshot-${+new Date()} --dry-run=client --output json`
    const job = JSON.parse(jobProcess.stdout)
    delete job.spec.template.spec.initContainers
    await $`echo ${JSON.stringify(job)}`.pipe($`kubectl apply -f -`)
  }

  /*
  Restore a snapshot of an app
  */
  async restore () {
    const snapshotsProcess = await $`kubectl -n ${this.kopiaNamespace} exec -it deployment/${this.kopiaApp} -- kopia snapshot list /data/${this.namespace}/${this.app}/${this.claim} --reverse --json`
    const snapshots = JSON.parse(snapshotsProcess.stdout)
    if (!snapshots.length) {
      console.error('404: ' + chalk.redBright(`no snapshots found for ${this.namespace}/${this.app}/${this.claim}`))
      process.exit(1)
    }

    if (this.snapshot === 'latest') {
      const [latest] = snapshots
      this.snapshot = latest.id
    }

    const appProcess = await $`kubectl get deploy,sts -n ${this.namespace} | awk '/${this.app}\\s/{print $1}'`
    const appController = appProcess.stdout.trim()

    $.env = {
      ...process.env,
      APP: this.app,
      NAMESPACE: this.namespace,
      CLAIM: this.claim,
      SNAPSHOT: this.snapshot
    }

    echo(await $`flux -n ${this.namespace} suspend helmrelease ${this.app}`)
    await $`kubectl -n ${this.namespace} scale ${appController} --replicas 0`
    await $`kubectl -n ${this.namespace} wait pod --for delete --selector="app.kubernetes.io/name=${this.app}" --timeout=2m`
    echo(await $`envsubst < <(cat ./hack/restore-job.yaml) | kubectl apply -f -`)
    await sleep(2000)
    let logReady = false
    while (!logReady) {
      console.log('waiting for logs...')
      const logProcess = $`kubectl -n ${this.namespace} logs --follow job/${this.app}-${this.claim}-restore-snapshot`
      logProcess.nothrow().stdout.on('data', (data) => {
        logReady = !data.includes('waiting to start')
        echo(data)
      })
      await sleep(3000)
    }
    await $`kubectl -n ${this.namespace} wait job --for condition=complete ${this.app}-${this.claim}-restore-snapshot --timeout=${this.timeout}`
    echo(await $`flux -n ${this.namespace} resume helmrelease ${this.app}`)
    await $`kubectl -n ${this.namespace} delete job ${this.app}-${this.claim}-restore-snapshot`
  }
}

export { Snapshot }
