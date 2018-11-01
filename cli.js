#!/usr/bin/env node
const fetch = require('node-fetch')
const { promisify } = require('util')
const dotenv = require('dotenv')
const execFile = promisify(require('child_process').execFile)
const chalk = require('chalk')
const ansiEscapes = require('ansi-escapes')
const supportsHyperlinks = require('supports-hyperlinks')

dotenv.config()

let supportLinks = supportsHyperlinks.stdout
if (supportsHyperlinks && process.env.TERM == "screen") {
  supportLinks = false
}
function isTmux() {
  return process.env.TMUX
}
function tmuxEscapeWrap(itermCommand) {
  if (process.env.TMUX) {
    // FIXME this sort of works, but isn't terminated quite correctly
    itermCommand = `\x1bPtmux;\x1b${itermCommand}\x1b\\`
  } 
  return itermCommand
}

function link(text, url) {
  let result = ansiEscapes.link(text, url)
  return result
  // return tmuxEscapeWrap(result)
}

const accessToken = process.env.GHSUP_TOKEN

class ProjectDirectory {
  constructor (directory) {
    if (!directory) {
      this.directory = process.cwd()
    } else {
      this.directory = directory
      process.chdir(this.directory)
    }
  }

  async collectRemote () {
    let result = await execFile('git', ['config', 'remote.origin.url'])
    if (result.error) {
      throw result.error
    }

    this.remote = result.stdout
    this.remote = this.remote.substring(0, this.remote.length - 1)
    const match = this.remote.match(/github\.com\/(\w+)\/(\w+)/)
    this.owner = match[1]
    this.name = match[2]
    return this.remote
  }

  async collectSha () {
    let result = await execFile('git', ['rev-parse', 'HEAD'])
    if (result.error) {
      throw result.error
    }

    this.sha = result.stdout
    this.sha = this.sha.substring(0, this.sha.length - 1)
    return this.sha
  }

  async collectEverything () {
    await this.collectRemote()
    await this.collectSha()
    await this.collectBranch()

    let results = await this.collectCommitsPage()
    this.pullRequest = results

    if (this.pullRequest) {
      let morePages = results.commits.pageInfo.hasPreviousPage
      let before = results.commits.pageInfo.startCursor

      let nextCommits = results.commits.edges.map(edge => edge.node.commit)
      this.commits = [].concat(nextCommits)

      while (morePages) {
        results = await this.collectCommitsPage(before)

        morePages = results.commits.pageInfo.hasPreviousPage
        before = results.commits.pageInfo.startCursor

        nextCommits = results.commits.edges.map(edge => edge.node.commit)
        this.commits = this.commits.concat(nextCommits)
      }
      this.commits.sort((a, b) => new Date(a.committedDate).getTime() - new Date(b.committedDate).getTime())
    }else {
      this.commits = []
    }
  }

  async collectCommitsPage (before) {
    let beforeQuery = ''
    if (before) { beforeQuery = `, before: "${before}"` }
    const query = `
      query {
        repository(owner:"${this.owner}", name:"${this.name}") {
          pullRequests(last: 1, headRefName: "${this.branch}") {
            edges {
              node {
                title
                number
                url
                createdAt
                url
                state
                headRef {
                  name
                  target {
                    oid
                  }
                }

                state
                mergeable
                mergeStateStatus

                commits(last: 20${beforeQuery}) {
                  edges {
                    node {
                      commit {
                        oid
                        message
                        author {
                          name
                          email
                          user {
                            login
                            url
                          }
                        }
                        pushedDate
                        committedDate
                        status {
                          state
                          contexts {
                            context
                            creator {
                              login
                            }
                            description
                            state
                            targetUrl
                          }
                        }
                      }
                    }
                  }
                  pageInfo {
                    startCursor
                    hasPreviousPage
                  }
                }
              }
            }
          }
        }
      }`

    let data = await this.fetchGraphql(query)
    if (data.errors) {
      throw JSON.stringify(data.errors, null, 2)
    }
    let edge = data.data.repository.pullRequests.edges[0]
    if (edge) {
      return edge.node
    } else {
      return null
    }
  }

  async fetchGraphql (query) {
    let res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      body: JSON.stringify({ query }),
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github.antiope-preview+json, application/vnd.github.merge-info-preview+json'
      }
    })

    let body = await res.text()
    let data = JSON.parse(body)

    if (res.status == 401) {
      throw data.message
    }

    if (res.status !== 200) {
      throw "non-200 from graphql :("
    }

    return data
  }

  async collectBranch () {
    let result = await execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
    if (result.error) {
      throw result.error
    }

    this.branch = result.stdout
    this.branch = this.branch.substring(0, this.branch.length - 1)
    return this.branch
  }
}

async function main (argv) {
  let directory
  const program = require('commander')
  program.arguments('[directory]')
    .action((directoryArgument) => {
      directory = directoryArgument
    })
  program.parse(process.argv)

  const projectDirectory = new ProjectDirectory(process.argv[2])
  await projectDirectory.collectEverything()
  let pullRequest = projectDirectory.pullRequest

  if (!pullRequest) {
    console.log(`No PR found`)
    return
  }

  const lastPullRequestCommit = projectDirectory.commits[projectDirectory.commits.length- 1]
  if (lastPullRequestCommit.oid !== projectDirectory.sha) {
    console.log(chalk.yellow('Warning, behind remote. git pull and all that to get up to date'))
  }

  const localShaCommitIndex = projectDirectory.commits.map(commit => commit.oid).indexOf(projectDirectory.sha)
  const commits = projectDirectory.commits.slice(localShaCommitIndex, projectDirectory.commits.length)

  let prStateStyle
  switch (pullRequest.state) {
    case 'CLOSED': prStateStyle = chalk.bgRed.black; break
    case 'MERGED': prStateStyle = chalk.bgMagenta.black; break
    case 'OPEN': prStateStyle = chalk.bgGreen.black; break
    default:  prStateStyle = chalk.white
  }

  let header = `${pullRequest.title} #${pullRequest.number}`
  if (supportLinks) {
    console.log(`${link(header, pullRequest.url)} ${prStateStyle(' ' + pullRequest.state + ' ')}`)
  } else {
    console.log(`${header} ${prStateStyle(pullRequest.state)} [${pullRequest.url}]`)
  }
  console.log()
  // console.log(projectDirectory.pullRequest.mergeStateStatus)

  let i = 0
  for (let commit of commits) {
    console.log(`commit ${commit.oid}`)

    let author
    if (commit.author.user) {
      if (supportLinks) {
        author = `${link('@' + commit.author.user.login, commit.author.user.url)}`
      } else {
        author = `@${commit.author.user.login} [${commit.author.user.url}]`
      }
    } else {
      author = `${commit.author.name} <${commit.author.email}>`
    }

    console.log(`Author: ${author}`)
    console.log(`Date: ${commit.committedDate}`)
    console.log()
    console.log(commit.message)
    console.log()

    if (commit.status) {
      for (let context of commit.status.contexts) {
        let statusStyle
        switch (context.state) {
          case 'SUCCESS': statusStyle = chalk.green; break
          case 'PENDING': statusStyle = chalk.yellow; break
          case 'FAILURE': statusStyle = chalk.red; break
          default:  statusStyle = chalk.white
        }

        if (supportLinks) {
          console.log(`${statusStyle(context.context)} ${link(context.description, context.targetUrl)}`)
        } else {
          console.log(`${statusStyle(context.context)} ${context.description} [${context.targetUrl}]`)
        }
      }

      // console.log(`${commit.committedDate} ${commit.oid} ${styledState}`)
      i++
    }
  }

  let mergeStatusDescription
  switch (pullRequest.mergeStateStatus) {
    case "UNKNOWN":
      mergeStatusDescription = `Checking merge status...`
    case "DIRTY":
      mergeStatusDescription = `This branch has conflicts that must be resolved`
    case "BLOCKED":
      mergeStatusDescription = `Merging is ${chalk.red('blocked')}`
      break
  }

  if (mergeStatusDescription) {
    console.log()
    console.log(mergeStatusDescription)
  }
}

main()
