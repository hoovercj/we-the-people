// Node Module Loading/Initialization
var request = require('request');
var redis = require('redis');
var Twitter = require('twitter');
var Tumblr = require('tumblrwks');
var url = require('url');
var async = require('async');
var fb = require('fb');
fb.setAccessToken(process.env.FACEBOOK_ACCESS_TOKEN);


// DB Variables
var redisURL = url.parse(process.env.REDISCLOUD_URL || 'redis://127.0.0.1:6379');
var client = redis.createClient(redisURL.port, redisURL.hostname, {no_ready_check: true});
if (!process.env.LOCAL == true) {
    client.auth(redisURL.auth.split(":")[1]);
}
var respondedPetitionsKey = 'respondedPetitions';
var openPetitionsKey = 'openPetitions';

// We The People API Variables
var limit = process.env.PETITION_LIMIT;
var weThePeopleBaseUrl = 'https://api.whitehouse.gov/v1/petitions.json?limit=' + limit;
var respondedParam = '&status=responded';
var openParam = '&status=open&isSignable=true&isPublic=true';

/*
 * Get New Responses and Post Them
 * This method uses async.waterfall to perform the following steps:
 * 1. Issue We The People API request to fetch Petition Responses.
 * 2. Performs a batch of sadd commands to add all responded petitions.
 *    Duplicates will NOT be added and will return a value of 0.
 *    New values WILL be added and will return a value of 1.
 * 3. Checks return values from sadd operation and posts new responses.
 */
function getNewResponsesAndPost(outerCallback) {
    async.waterfall([
         // 1. Issue We The People API request to fetch Petition Responses.
        function (callback) {
            console.log('In getPetitionsFromAPI');
            request({uri: weThePeopleBaseUrl + respondedParam}, function (error, response, body) {
                callback(error, body);
            });
        }, // 2. Performs a batch of sadd commands to add all responded petitions.
        function (data, callback) {
            console.log('In addRespondedPetitionsToDB');
            var respondedPetitions = JSON.parse(data).results;
            var responses = parseResponses(respondedPetitions);

            // Create a multi command object
            var multi = client.multi();
            // for each responded petition, create sadd command
            // add the id of the RESPONSE, not the petition itself,
            // because each response can have multiple petitions
            // and it isn't useful to post 5 times for each response
            Object.keys(responses).forEach(function(responseId) {
                multi.sadd(respondedPetitionsKey, responseId);
            });
            // for (var i = 0; i < responses.length; i++) {
            //     multi.sadd(respondedPetitionsKey, responses[i].response.id);
            // }

            // Execute the list of sadd operations
            multi.exec(function(err, replies) {
                callback(err, replies, responses);
            });
        }, // 3. Checks return values from sadd operation and posts new responses.
        function (replies, responses, callback) {
            console.log('In postRespondedPetitions');
            // For each response, a value of 1 means it is new
            // In that case, share on social media
            var responseIds = Object.keys(responses);
            replies.forEach(function (reply, index) {
                if ( reply == 1 /*1 means added -> new*/) {
                    var response = responses[responseIds[index]];
                    console.log('NEW Response: ' + responseIds[index] + ' - ' + response.petitions.join[', ']);
                    // post to social media?
                    facebookNewResponse(response);
                    tumblrNewResponse(response);
                    tweetReponse(response);
                }
            });
            callback(null);
        }], function (err) {
            outerCallback(err, 'PetitionResponseWaterfall');
        }
    );
}


/*
 * Get New Petitions and Post Them
 * This method uses async.waterfall to perform the following steps:
 * 1. Issue We The People API request to fetch open petitions.
 * 2. Performs a batch of sismember commands to check if petitions have been added already.
 *    Existing petitions will return a value of 0.
 *    New petitions will return a value of 1.
 * 3. Checks return values from sismember operation and posts new responses.
 * 4. The open petitions store is cleared and then populated with the new values.
 *    This is done to ensure that storage remaines small and the openPetitionsKey
 *    only contains values that are currently open.
 */
function getOpenPetitionsAndPost(outerCallback) {
    async.waterfall([
        // 1. Issue We The People API request to fetch open petitions.
        function (callback) {
            console.log('In getPetitionsFromAPI');
            request({uri: weThePeopleBaseUrl + openParam}, function (error, response, body) {
                callback(error, body);
            });
        }, // 2. Performs a batch of sismember commands to check if petitions have been added already.
        function (data, callback) {
            console.log('In checkOpenPetitionsInDB');
            var openPetitions = JSON.parse(data).results;

            // Create a multi command object
            var multi = client.multi();
            // for each responded petition, create sadd command
            for (var i = 0; i < openPetitions.length; i++) {
                multi.sismember(openPetitionsKey, openPetitions[i].id);
            }
            // Execute the list of sadd operations
            multi.exec(function(err, replies) {
                callback(err, replies, openPetitions);
            });
        }, // 3. Checks return values from sismember operation and posts new responses.
        function (replies, openPetitions, callback) {
            console.log('In postOpenPetitions');
            // For each response, a value of 1 means it is new
            // In that case, share on social media
            replies.forEach(function (reply, index) {
                if (reply == 0 /* 0 means NOT already in DB */) {
                    console.log('NEW Petitions: ' + openPetitions[index].id + ' - ' + openPetitions[index].title);
                    // post to social media?
                    var petition = openPetitions[index];
                    facebookOpenPetition(petition);
                    tumblrOpenPetition(petition);
                    tweetOpenPetition(petition);
                }
            });
            callback(null, openPetitions);
        }, // 4. The open petitions store is cleared and then populated with the new values.
        function(openPetitions, callback) {
            console.log('In setOpenPetitions');
            var openPetitionIds = [];
            openPetitions.forEach(function (petition, index) {
                openPetitionIds.push(petition.id);
            });
            var multi = client.multi();
            multi.del(openPetitionsKey);
            multi.sadd(openPetitionsKey, openPetitionIds);
            multi.exec(function(err, replies) {
                callback(err)
            });
        }], function (err) {
            outerCallback(err, 'OpenPetitionWaterfall');
        }
    );
}

// Parsing Helpers

/**
 * @param {object} respondedPetitions - Same format as the Whitehouse API
 * https://petitions.whitehouse.gov/developers#petitions-retrieve
 * @returns { id: { url: string, petitions: string[]} }
 */
function parseResponses(respondedPetitions) {
    let responses = Object.create({});
    respondedPetitions.forEach(function(petition) {
        var responseId = petition.response.id;
        if (!responses[responseId]) {
            responses[responseId] = Object.create({url: petition.response.url, petitions: []});
        }
        responses[responseId].petitions.push('"' + petition.title + '"');
    });
    return responses;
}


// Twitter Variables & Initialization
var twitter = new Twitter(
    {
        consumer_key: process.env.TWITTER_CONSUMER_KEY,
        consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
        access_token_key: process.env.TWITTER_ACCESS_TOKEN,
        access_token_secret: process.env.TWITTER_ACCESS_SECRET
    }
);
var twitterHashtags = '#WeThePeople'

var TWITTER_URL_LENGTH = 23;
function tweet(prefix, title, url) {
    // This snippet trims the title to be appropriate for tweet.
    // The overhead for a tweet is the the prefix (e.g. "NEW RESPONSE: "), URL, the hashtags, and the space between the text, url, and hashtags.
    // This takes that into account and trims the title if necessary to keep tweets under 140 characters.
    var maxTitleLength = 140 - (Math.min(TWITTER_URL_LENGTH, url.length) + prefix.length + twitterHashtags.length + 2 /* num spaces */);
    if (maxTitleLength < title.length) {
        title = title.slice(0, maxTitleLength - 3 /* for elipses */) + '...';
    }
    var tweetText = prefix + title + ' ' + url + ' ' + twitterHashtags;

    twitter.post('statuses/update', {status: tweetText},  function(error, tweet, response){
        if(error) {
            console.error(error);
        } else {
            console.log('Tweeted: '+ JSON.stringify(tweet));  // Tweet body.
        }
    });
}

function tweetOpenPetition(openPetition) {
    tweet('New Petition: ', openPetition.title, openPetition.url);
}

/**
 * @param { id: { url: string, petitions: string[]} } response
 */
function tweetReponse(response) {
    tweet('New Response: ', response.petitions[0], response.url);
}

// Tumblr Variables & Initialization
var tumblrTags = 'We The People,White House Petitions,Petitions,Change,Democracy';
var tumblr = new Tumblr(
    {
        consumerKey: process.env.TUMBLR_CONSUMER_KEY,
        consumerSecret: process.env.TUMBLR_CONSUMER_SECRET,
        accessToken: process.env.TUMBLR_ACCESS_TOKEN,
        accessSecret: process.env.TUMBLR_ACCESS_SECRET
    }, process.env.TUMBLR_BLOG_URL
);

function tumblrPost(postTitle, postDescription, postUrl) {
    tumblr.post('/post', {type: 'link', title: postTitle, description: postDescription, url: postUrl, tags: tumblrTags}, function(err, json) {
        if (err) {
            console.error('Error posting to Tumblr');
            console.error(err);
        } else {
            console.log('Posted to Tumblr: ' + postTitle);
        }
    });
}

function tumblrOpenPetition(openPetition) {
    tumblrPost(openPetition.title, openPetition.body, openPetition.url);
}

/**
 * @param { id: { url: string, petitions: string[]} } response
 */
function tumblrNewResponse(response) {
    var title = '';
    var body = '';
    if (response.petitions.length == 1) {
        title = 'The whitehouse just issued a response to ' + response.petitions[0];
    } else {
        title = 'The whitehouse just issued a response to ' + response.petitions.length + ' petitions';
        body = response.petitions.join("\n");
    }
    tumblrPost(title, body, response.url);
}


// Facebook Methods
function facebookPost(text, url) {
    fb.api('/' + process.env.FACEBOOK_PAGE_ID + '/feed', 'post', { message: text, link: url}, function (res) {
        if(!res || res.error) {
            console.log(!res ? 'error occurred' : res.error);
            return;
        }
        console.log('Posted to FB: ' + res.id);
    });
}

function facebookOpenPetition(openPetition) {
    facebookPost(openPetition.title + '\n\n' + openPetition.body, openPetition.url);
}

/**
 * @param { id: { url: string, petitions: string[]} } response
 */
function facebookNewResponse(response) {
    var message = '';
    if (response.petitions.length == 1) {
        message = 'We did it! The whitehouse has issued a response to ' + response.petitions[0];
    } else {
        message = 'We did it! The whitehouse has issued a response to ' + response.petitions.length + ' petitions:' + "\n" + response.petitions.join("\n");
    }
    facebookPost(message, response.url);
}

// Main Method
function main() {
    // Use async.parallel to fetch and post new responses and open petitions in parallel
    // and know when they are both finished so the redis client can close its connection.
    // This is necessary so the node process will exit.
    async.parallel([
        getNewResponsesAndPost,
        getOpenPetitionsAndPost
    ],
    function(err, results){
        if (err) console.log(err);
        client.quit();
    });
}
main();