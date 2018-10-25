const fetch = require('node-fetch')
const dotenv = require('dotenv')
const result = dotenv.config()
if (result.error) {
  throw result.error
}

const accessToken = process.env.GHSUP_TOKEN
const query = `
  query {
    repository(owner:"isaacs", name:"github") {
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
