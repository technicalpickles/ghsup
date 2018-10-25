const fetch = require('node-fetch')
const {promisify} = require('util');
const dotenv = require('dotenv')
const result = dotenv.config()
const execFile = promisify(require('child_process').execFile)

if (result.error) {
  throw result.error
}

process.chdir(process.argv[2])

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
    const query = `
      query {
        repository(owner:"${owner}", name:"${name}") {
          pullRequests(last: 20) {
            edges {
              node {
                number
              }
            }
          }
        }
        viewer {
          login
        }
      }`

    return fetch('https://api.github.com/graphql', {
      method: 'POST',
      body: JSON.stringify({ query }),
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    })
  }).then(res => res.text()
  ).then(body => console.log(JSON.stringify(JSON.parse(body), null, 2))
  ).catch(error => console.error(error))
