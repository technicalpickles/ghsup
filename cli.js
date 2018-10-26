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
var remote
var owner
var name
var branch
execFile('git', ['config', 'remote.origin.url'])
  .then((result) => {
    if (result.error) {
      throw result.error
    }

    remote = result.stdout
    const match = remote.match(/github\.com\/(\w+)\/(\w+)/)
    owner = match[1]
    name = match[2]

    return execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
  }).then((result) => {
    if (result.error) {
      throw result.error
    }

    branch = result.stdout
    branch = branch.substring(0, branch.length - 1)
    const query = `
      query {
        repository(owner:"${owner}", name:"${name}") {
          pullRequests(last: 1, headRefName: "${branch}") {
            edges {
              node {
                createdAt
                url
                state
                headRefName

                commits(last: 1) {
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
                }
              }
            }
          }
        }
      }`

    return fetch('https://api.github.com/graphql', {
      method: 'POST',
      body: JSON.stringify({ query }),
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github.antiope-preview+json'
      }
    })
  }).then(res => res.text()
  ).then(body => JSON.parse(body)
  ).then(data => data.data.repository.pullRequests.edges[0].node
  ).then(pullRequest => {
    const commit = pullRequest.commits.edges[0].node.commit
    for (let context of commit.status.contexts) {
      var styledContext
      switch (context.state) {
        case "SUCCESS": styledContext = chalk.green(context.context) ; break
        case "PENDING": styledContext = chalk.yellow(context.context); break
        case "FAILURE": styledContext = chalk.red(context.context); break
      }
      console.log(`${styledContext}: ${context.description}`)
    }
    // console.log(JSON.stringify(commit, null, 2))
  }).catch(error => console.error(error))
