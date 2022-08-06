#!/usr/bin/env zx
import { $, path, os, fs, argv, fetch, cd, within, chalk } from 'zx'
import { finished } from 'node:stream/promises'
import archiver from 'archiver'
import crypto from 'crypto'

if (argv.h || argv.help) {
  console.log(`${argv._} [--target <name of target>] [--node-version <version>]`)
  console.log()
  console.log('Targets can be "linux", "linux-amd64", "linux-arm64", "darwin", "darwin-amd64", "darwin-arm64".')
  console.log('If target does not indicate an architecture it will build all architectures for that platform.')
  console.log('Target may be specified multiple times to build multiple targets.')
  console.log()
  console.log('Node version should be in the format "v#.#.#". For example: "v18.4.0')
  console.log()
  process.exit(0)
}

const targets = (Array.isArray(argv.target) ? argv.target : [argv.target])
  .filter(v => !!v)
  .map(v => v.toLowerCase())

const nodeVersion = argv.nodeVersion || process.version
const matrix = [
  // [platform, arch, download extension, target extension, mirror]
  ['linux', 'amd64', '.tar.xz', '', ''],
  // TODO: build for amd64 musl
  // Tried using the unofficial amd64-musl build, but when you try to run that build of `node`
  // in alpine container, we get lots of errors like:
  // Error relocating /tmp/caxa/applications/gluctl/linux-amd64-musl-1659414624544/0/node_modules/.bin/node: _ZSt4cerr: symbol not found
  // ['linux', 'amd64-musl', '.tar.xz', '', 'https://unofficial-builds.nodejs.org/download/release'],
  ['linux', 'arm64', '.tar.xz', '', ''],
  ['darwin', 'amd64', '.tar.gz', '', ''],
  ['darwin', 'arm64', '.tar.gz', '', '']
  // TODO: add windows build...maybe?
  // ['win', 'amd64', '.zip', '.exe', '']
].filter(([platform, arch]) => {
  if (targets.length === 0) return true

  const key = `${platform}-${arch}`
  return targets.filter(target => key.indexOf(target) === 0).length > 0
})

const caxaMap = {
  win: 'win32',
  amd64: 'x64',
  'amd64-musl': 'x64'
}

const nodeDownloadMap = {
  amd64: 'x64',
  'amd64-musl': 'x64-musl'
}

/**
 * Copies the application minus git, modules, etc. We will then install non-dev depenendencies.
 * This helps keep the binary smaller since it won't include a bunch libraries used during development
 */
async function createBaseApp ({ tmpDir }) {
  console.log(chalk.greenBright('Creating production install of application'))
  const src = process.cwd()
  const destDir = `${tmpDir}/app`
  const ignoredPaths = ['.github', 'dist', '.git', 'node_modules', '.vscode', 'scripts'].map(dir => `${src}/${dir}`)
  await fs.mkdir(destDir, { recursive: true })
  await fs.copy(src, destDir, { filter: name => ignoredPaths.indexOf(name) < 0 })
  await within(async () => {
    cd(destDir)
    await $`npm ci --omit dev`
  })
  return destDir
}

/**
 * Downloads the node archive for the given platform and architecture
 */
async function downloadNode ({ platform, arch, ext, version, tmpDir, nodeMirror }) {
  const nodeArchiveName = `node-${version}-${nodeDownloadMap[platform] ?? platform}-${nodeDownloadMap[arch] ?? arch}${ext}`
  const url = `${nodeMirror || 'https://nodejs.org/dist'}/${version}/${nodeArchiveName}`
  const downloadDest = path.normalize(`${tmpDir}/${nodeArchiveName}`)
  try {
    // check if the destination already exists
    await fs.access(downloadDest, fs.constants.F_OK)
    // if it does, we'll just assume it's correct and just return our destination path
    return downloadDest
  } catch (e) {
    console.log(chalk.greenBright(`Downloading ${path.basename(url)}`))
    // if it does not exist, we must download it
    const res = await fetch(url)
    const fileStream = fs.createWriteStream(downloadDest)
    await new Promise((resolve, reject) => {
      res.body.pipe(fileStream)
      res.body.on('error', reject)
      fileStream.on('finish', resolve)
    })
    // return where we downloaded the archive to
    return downloadDest
  }
}

async function extractNodeBinary (nodeArchive, dest) {
  await fs.remove(dest)

  await within(async () => {
    const archiveDir = path.dirname(nodeArchive)
    cd(archiveDir)
    const nodeBinArchivePath = `${path.basename(nodeArchive).replace(/(\.tar\.gz|\.tar\.xz|.zip)/, '')}/bin/node`
    // todo: unzip for windows archive instead of tar
    await $`tar -xf ${nodeArchive} ${nodeBinArchivePath}`
    await fs.move(`${archiveDir}/${nodeBinArchivePath}`, dest)
  })
  return dest
}

/**
 * Gets the path to the stub file for the given platform/arch from node_modules
 */
async function getStubPath ({ platform, arch }) {
  const caxaPath = path.join(process.cwd(), 'node_modules', 'caxa')
  const stubName = `stub--${caxaMap[platform] ?? platform}--${caxaMap[arch] ?? arch}`
  const stubPath = path.join(`${caxaPath}`, 'stubs', stubName)
  await fs.access(stubPath, fs.constants.F_OK)
  console.log(chalk.greenBright(`Using caxa stub ${path.basename(stubPath)}`))
  return stubPath
}

/**
 * Creates the application as a gzipped tarball
 */
async function buildAppArchive ({ platform, arch, ext, nodeVersion, tmpDir, baseAppDir, nodeMirror }) {
  // download and extract the node binary for the platform
  const nodeArchive = await downloadNode({ platform, arch, ext, version: nodeVersion, tmpDir, nodeMirror })
  const nodeBinary = await extractNodeBinary(nodeArchive, path.join(tmpDir, `node-${platform}-${arch}`))

  const appDir = `${tmpDir}/app-${platform}-${arch}`
  const appArchive = `${appDir}.tar.gz`

  try {
    // copy the base app to as our app dir
    await fs.copy(baseAppDir, appDir, { recursive: true, force: true })

    // add node to the node_modules
    await fs.move(nodeBinary, path.join(appDir, 'node_modules', '.bin', 'node'))

    // create archive
    const archive = archiver('tar', { gzip: true })
    const archiveStream = fs.createWriteStream(appArchive, { flags: 'w' })
    archive.pipe(archiveStream)
    archive.directory(appDir, false)
    await archive.finalize()
    await finished(archiveStream)

    // clean up our temporary app dir
    await fs.rm(appDir, { recursive: true, force: true })

    return appArchive
  } catch (e) {
    await fs.rm(appDir, { force: true, recursive: true })
    await fs.rm(appArchive, { force: true })
    throw e
  }
}

/**
 * Builds the full application binary for the given platform, architecture, etc
 * This is done by first taking a copy of the "stub" provided by caxa for given platform+arch
 * Then we append the application gzipped tarball
 * Finally we append a JSON string that includes a unique identifier (used as part of the destination
 * when the stub self-extracts...so make it unique or it will skip self-extracting) and a command
 * that should be run when the "binary" is executed.
 */
async function buildTarget ({ platform, arch, ext, targetExt, nodeVersion, tmpDir, distDir, baseAppDir, nodeMirror }) {
  console.log(`Building app for ${platform}-${arch}`)
  const appArchive = await buildAppArchive({ platform, arch, ext, nodeVersion, tmpDir, baseAppDir, nodeMirror })
  const targetFile = path.join(distDir, `gluctl-${platform}-${arch}${targetExt}`)

  // create the target dist file stream
  await fs.mkdirp(path.dirname(targetFile))
  await fs.remove(targetFile)
  const distStream = fs.createWriteStream(targetFile, { mode: 0o755 })

  // add the stub
  const stubPath = await getStubPath({ platform, arch })
  const stubStream = fs.createReadStream(stubPath)
  stubStream.pipe(distStream, { end: false })
  await finished(stubStream)

  // add the gzipped app archive
  // await fs.copy(stubPath, targetFile)
  const appStream = fs.createReadStream(appArchive)
  appStream.pipe(distStream, { end: false })
  await finished(appStream)

  // write the json manifest to tell the stub what to do
  distStream.write('\n' + JSON.stringify({
    identifier: `gluctl/${platform}-${arch}-${+new Date()}`,
    // explicitly call node and zx so we are using the ones in our archive, and not whatever the user has installed
    command: ['{{caxa}}/node_modules/.bin/node', '{{caxa}}/node_modules/.bin/zx', '{{caxa}}/gluctl']
  }))
  distStream.end()

  // write package checksum
  const distBuffer = await fs.readFile(targetFile)
  const hash = crypto.createHash('sha256')
  hash.update(distBuffer)
  const checksum = hash.digest('hex')
  const checksumFile = path.join(distDir, `checksums.txt`)
  await fs.appendFile(checksumFile, `${checksum}  gluctl-${platform}-${arch}${targetExt}\n`)

  return targetFile
}

/**
 * This is where we actually initate building
 */
within(async () => {
  const tmpDir = `${os.tmpdir()}/gluctl-build-dir`
  await fs.mkdir(tmpDir, { recursive: true })

  const baseAppDir = await createBaseApp({ tmpDir })

  await Promise.all(matrix.map(async ([platform, arch, ext, targetExt, nodeMirror]) => {
    try {
      await buildTarget({ platform, arch, ext, targetExt, nodeVersion, tmpDir, distDir: `${process.cwd()}/dist`, baseAppDir, nodeMirror })
    } catch (e) {
      console.error(`Failed to build app for ${platform}-${arch}`, e)
      process.exit(1)
    }
  }))
})
