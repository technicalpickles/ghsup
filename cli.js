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

// process.chdir(process.argv[2])

const accessToken = process.env.GHSUP_TOKEN
var owner
var name
var branch

class ProjectDirectory {
  constructor(directory) {
    this.directory = directory
  }

  async collectRemote() {
    return execFile('git', ['config', 'remote.origin.url'])
      .then((result) => {
        if (result.error) {
          throw result.error
        }

        this.remote = result.stdout
        this.remote = this.remote.substring(0, this.remote.length - 1)
        const match = this.remote.match(/github\.com\/(\w+)\/(\w+)/)
        this.owner = match[1]
        this.name = match[2]
        return this.remote
      })
  }

  async collectEverything() {
    await this.collectRemote()
    await this.collectBranch()
    await this.collectCommitsPage()

    console.log("first page")
    var results = await this.collectCommitsPage()
    this.pullRequest = results

    var morePages = results.commits.pageInfo.hasPreviousPage
    var before = results.commits.pageInfo.startCursor

    var nextCommits = results.commits.edges.map(edge => edge.node.commit)
    this.commits = [].concat(nextCommits)

    while (morePages) {
      results = await this.collectCommitsPage(before)

      morePages = results.commits.pageInfo.hasPreviousPage
      before = results.commits.pageInfo.startCursor

      console.log(`before ${before}`)
      nextCommits = results.commits.edges.map(edge => edge.node.commit)
      this.commits = this.commits.concat(nextCommits)

    }
    console.log(JSON.stringify(this.commits, null, 2))

  }

  async collectCommitsPage(before) {
    var beforeQuery = ""
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
                headRefName

                commits(last: 20${beforeQuery}) {
                  edges {
                    node {
                      commit {
                        oid
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

    return this.fetchGraphql(query).then(data => {
      console.log(JSON.stringify(data, null, 2))
      return data.data.repository.pullRequests.edges[0].node
    })
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
    return execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
      .then((result) => {
        if (result.error) {
          throw result.error
        }

        this.branch = result.stdout
        this.branch = this.branch.substring(0, this.branch.length - 1)
        return this.branch
      })
  }
}

const projectDirectory = new ProjectDirectory()
projectDirectory.collectEverything().then(() => {

  // const commit = projectDirectory.pullRequest.commits.edges[0].node.commit
  // for (let context of commit.status.contexts) {
  //   var styledContext
  //   switch (context.state) {
  //     case "SUCCESS": styledContext = chalk.green(context.context) ; break
  //     case "PENDING": styledContext = chalk.yellow(context.context); break
  //     case "FAILURE": styledContext = chalk.red(context.context); break
  //   }
  //   console.log(`${styledContext}: ${context.description}`)
  // }
})
