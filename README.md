# we-the-people
Script to automate posting new petitions and responses from https://petitions.whitehouse.gov/ to Facebook, Twitter, and Tumblr

It is a node script that runs as a scheduled task on Heroku and uses RedisCloud storage.

## Major Components
### .env
There are many environment variables that you will need to use to keep private information out of your code and repository. These variables are accessed using `process.env.VARIABLE_NAME`
To set these variables for local use, have a file named `.env` in the root directory. A documented sample file named `sample.env` has been included. `.env` is already
in `.gitignore` to prevent you from accidentally adding it to your repo with your secrets.

The values here will only be fetched if you run foreman. The Heroku Toolbelt includes the `foreman` command but can have issues. I recommend installing [foreman from npm](https://www.npmjs.com/package/foreman) as described here and using the `nf` command

### Heroku Environment Variables
The variables in .env are only available locally. To make them available in Heroku, issue commands like the following:

    $ heroku config:set VARIABLE_ONE=1 VARIABLE_TWO=2

This will set VARIABLE_ONE to 1 and VARIABLE_TWO to 2

### Procfile
This defines jobs that frontman can run.

```
accessTokens: node accessTokens.js
main: node main.js
clearDB: node clearDB.js
seedDB: node seedDB.js
```

For example, to run `accessTokens.js` you can run the command:
`$ nf accessTokens`

*Remember:* To have access to the environment variables in a local environment, frontman must be used. Therefore the file must be in the `Procfile`

### accessTokens.js
Creates a node server to generate access tokens for Facebook and Tumblr. This is not necessary for Twitter which kindly gives it to you in the developer panel.

#### Configuration
##### Tumblr
You will need some Environment Variables which can be obtained by creating an app [here](https://www.tumblr.com/oauth/apps):
* `TUMBLR_CONSUMER_KEY`
* `TUMBLR_CONSUMER_SECRET`

It also uses some more general ones:
* `URL` - The URL this is being run from (e.g http://localhost, http://app-name.herokuapp.com)
* 'PORT'  - The port it is being run on. Defaults to 5000 if nothing is provided

##### Facebook
Facebook also requires special environment variables that are extracted from the [developer console](https://developers.facebook.com/apps/) or the 'About Tab' for the page you want to post to. 

*Note:* The FACEBOOK_REDIRECT_URL must be the same as the one listed in the app settings.

* FACEBOOK_APP_ID
* FACEBOOK_APP_SECRET
* FACEBOOK_PAGE_ID
* FACEBOOK_REDIRECT_URL

#### Getting Access Tokens
Once you've configured it, you can run it using:
`$ nf accessTokens`

There are two endpoints available, `/auth/tumblr` and `/auth/facebook`. 
Assuming you are running it from `localhost:5050` you can open a browser and go to `http://localhost:5050/auth/tumblr`, authorize the application, and view the relevant secrets. Add these to your .env file.

### main.js
This is the script that is scheduled. It uses `redis` for storage, `async` for managing the flow, `request` for the raw requests, and modules for each social network.

#### redis
Redis is a simple NOSQL key-value store. All commands are executed asynchronously. This script leverages the `set` type for storage and merely stores the ID's of the petitions. When logical, multiple `sadd` or `sismember` calls are batched using the `multi` functionality.

The most important part, though, is that the redis client needs to be closed for the node process to exit. Since this is a scheduled job, it shouldn't be running forever. Therefore, after all db operations are done, `client.quit()` needs to be called. This is done by using `async` to string together the db calls and close the connection when they've all returned.

##### Config
* `REDISCLOUD_URL` is used but is already defined for you IF you use the rediscloud add-on for heroku. Find that variable in the heroku configuration with `$ heroku config:get REDISCLOUD_URL` if you wish to connect to redis locally. Otherwise, the script will default to using a local version of redis. That means you must have redis running locally if you are not connecting to the remote redis server.
* `LOCAL` should be set to `true` to bypass the auth part if you are running a local redis server that isn't using authentication. 

#### async
async manages the control flow of the asyncronous request and db calls. 

Each of the two main tasks (1. Getting new responses and posting, 2. Getting new open petitions and posting) is done in their own `async.waterfall` block. In waterfall block, each step returns a value which is used by the next step.

The two main tasks are tied together in a `async.parallel` block. Parallel blocks take an array of functions and execute them in parallel (though this is node.js, so it is still single threaded), and executes a final callback when they complete. This final callback is where we close the redis connection.

#### Main config
* `PETITION_LIMIT` - the amount of petitions to grab from any request. The request returns 10 by default, setting a limit allows you to get more than that. At the moment there are ~250 responses and ~70 open petitions at any given time.

#### Running the Script
To run it locally, run `$ nf main`. Otherwise, to run directly from heroku, you can issue the command `heroku run node main.js'

To avoid posting hundreds of things on the first run you can first run `$ nf seedDB` which will grab all open and responded petitions and put them into the db so that future runs of `main.js` will only post the newest ones.

To clear the db, run `$ nf clearDB`

To schedule this job to be run at intervals of `every 10 minutes`, `every hour`, `daily`, add the `scheduler` add-on to your heroku app, select the interval, and set the task to `node main.js`.


