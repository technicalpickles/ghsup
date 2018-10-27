#!/usr/bin/env node
const fetch = require('node-fetch')
const {promisify} = require('util');
const dotenv = require('dotenv')
const result = dotenv.config()
const execFile = promisify(require('child_process').execFile)
const chalk = require('chalk')

if (result.error) {
  throw result.error
}


const accessToken = process.env.GHSUP_TOKEN

class ProjectDirectory {
  constructor(directory) {
    this.directory = directory
    // process.chdir(this.directory)
  }

  async collectRemote() {
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

  async collectSha() {
    let result = await execFile('git', ['rev-parse', 'HEAD'])
    if (result.error) {
      throw result.error
    }

    this.sha = result.stdout
    this.sha = this.sha.substring(0, this.sha.length - 1)
    return this.sha
  }

  async collectEverything() {
    await this.collectRemote()
    await this.collectSha()
    await this.collectBranch()

    let results = await this.collectCommitsPage()
    this.pullRequest = results

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
  }

  async collectCommitsPage(before) {
    let beforeQuery = ""
    if (before) { beforeQuery = `, before: "${before}"` }
    const query = `
      query {
        repository(owner:"${this.owner}", name:"${this.name}") {
          pullRequests(last: 1, headRefName: "${this.branch}") {
            edges {
              node {
                createdAt
                url
                state
                headRef {
                  name
                  target {
                    oid
                  }
                }

                commits(last: 20${beforeQuery}) {
                  edges {
                    node {
                      commit {
                        oid
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
    // console.log(JSON.stringify(data, null, 2))
    return data.data.repository.pullRequests.edges[0].node
  }

  async fetchGraphql(query) {
    return fetch('https://api.github.com/graphql', {
      method: 'POST',
      body: JSON.stringify({ query }),
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github.antiope-preview+json'
      }
    }).then(res => res.text()
    ).then(body => JSON.parse(body)
    ).catch(error => console.error(error))
  }

  async collectBranch() {
    let result = await execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
    if (result.error) {
      throw result.error
    }

    this.branch = result.stdout
    this.branch = this.branch.substring(0, this.branch.length - 1)
    return this.branch
  }
}

async function main() {
  const projectDirectory = new ProjectDirectory(process.argv[2])
  await projectDirectory.collectEverything()

  const lastPullRequestCommit = projectDirectory.commits[projectDirectory.commits.length- 1]
  if (lastPullRequestCommit.oid != projectDirectory.sha) {
    console.log(chalk.yellow("Warning, behind remote. git pull and all that to get up to date"))
  }

  const localShaCommitIndex = projectDirectory.commits.map(commit => commit.oid).indexOf(projectDirectory.sha)
  console.log(lastPullRequestCommit.oid)
  console.log(projectDirectory.sha)
  console.log(localShaCommitIndex)
  // debugger
  // const commits = projectDirectory.commits.slice(localShaCommitIndex, projectDirectory.commits.length - 1)
  const commits = projectDirectory.commits

  for (let commit of commits) {
    let styledState = ""
    if (commit.status) {
      switch (commit.status.state) {
        case "SUCCESS": styledState = chalk.green("passed") ; break
        case "PENDING": styledState = chalk.yellow("pending"); break
        case "FAILURE": styledState = chalk.red("failed"); break
      }
    }
    console.log(`${commit.committedDate} ${commit.oid} ${styledState}`)
  }

  // const commit = projectDirectory.pullRequest.commits.edges[0].node.commit
  // for (let context of commit.status.contexts) {
  //   let styledContext
  //   switch (context.state) {
  //     case "SUCCESS": styledContext = chalk.green(context.context) ; break
  //     case "PENDING": styledContext = chalk.yellow(context.context); break
  //     case "FAILURE": styledContext = chalk.red(context.context); break
  //   }
  //   console.log(`${styledContext}: ${context.description}`)
  // }
}

main()
