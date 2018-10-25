const fetch = require('node-fetch')
const dotenv = require('dotenv')
const result = dotenv.config()
if (result.error) {
  throw result.error
}

process.chdir(process.argv[2])


const { execFile } = require('child_process')
const child = execFile('git', ['config', 'remote.origin.url'], (error, stdout, stderr) => {
  if (error) {
    throw error
  }

  const remote = stdout
  const match = remote.match(/github\.com\/(\w+)\/(\w+)/)
  const owner = match[1]
  const repo = match[2]


  const accessToken = process.env.GHSUP_TOKEN
  const query = `
    query {
      repository(owner:"${owner}", name:"${repo}") {
        issues(states:CLOSED) {
          totalCount
        }
      }
    }`

  fetch('https://api.github.com/graphql', {
    method: 'POST',
    body: JSON.stringify({ query }),
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  }).then(res => res.text())
    .then(body => console.log(body)) // {"data":{"repository":{"issues":{"totalCount":247}}}}
    .catch(error => console.error(error))
})


