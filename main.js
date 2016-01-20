// Node Module Loading/Initialization
var request = require('request');
var redis = require('redis');
var Twitter = require('twitter');
var Tumblr = require('tumblr.js')
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
 * 2. Parses and sorts responses and executes an sismember query for all of them
 * 3. Finds the first rsponse that is not already in the database, posts it, and saves it.
 */
function getNewResponsesAndPost(outerCallback) {
    async.waterfall([
         // 1. Issue We The People API request to fetch Petition Responses.
        function (callback) {
            console.log('In getNewResponsesAndPost');
            request({uri: weThePeopleBaseUrl + respondedParam}, function (error, response, body) {
                callback(error, body);
            });
        }, // 2. Parses and sorts responses and posts the oldest response that hasn't already been posted
           // and then adds it to the database.
        function (data, callback) {
            console.log('In addRespondedPetitionsToDB');
            var respondedPetitions = JSON.parse(data).results;
            var responses = parseResponses(respondedPetitions);

            // Create a multi command object
            var multi = client.multi();
            // For each response, create an sismember command.
            // Use the id of the RESPONSE, not the petition itself,
            // because each response can have multiple petitions
            // and it isn't useful to post 5 times for each response
            responses.forEach(function(response) {
                multi.sismember(respondedPetitionsKey, response.id);
            });

            // Execute the list of sismember operations
            multi.exec(function(err, replies) {
                callback(err, replies, responses);
            });
        }, // 3. Checks return values from sismember operations and posts the first new response.
        function (replies, responses, callback) {
            console.log('In postRespondedPetitions');
            // For each response, a value of 0 means it is not currently in the database
            // In that case, share on social media and add it to the database.
            for (var i = 0; i < replies.length; i++) {
            // replies.forEach(function (reply, index) {
                if ( replies[i] == 0 /*0 means not in database*/) {
                    var response = responses[i];
                    console.log('NEW Response: ' + response.id + ' - ' + response.petitions.join[', ']);
                    // post to social media?
                    facebookNewResponse(response);
                    tumblrNewResponse(response);
                    tweetReponse(response);
                    client.sadd(respondedPetitionsKey, responses[i].id)
                    break;
                }
            }
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
 * 3. Checks return values from sismember operation and posts the oldest "new" petition.
 */
function getOpenPetitionsAndPost(outerCallback) {
    async.waterfall([
        // 1. Issue We The People API request to fetch open petitions.
        function (callback) {
            console.log('In getOpenPetitionsAndPost');
            request({uri: weThePeopleBaseUrl + openParam}, function (error, response, body) {
                callback(error, body);
            });
        }, // 2. Finds the oldest petition that hasn't been posted yet, posts it, and adds it to the database.
        function (data, callback) {
            console.log('In checkOpenPetitionsInDB');
            var openPetitions = JSON.parse(data).results.sort(function(a, b) { return a.created - b.created; });
            
            // Create a multi command object
            var multi = client.multi();
            // for each petition, create sismember command
            console.log('Open petitions: ' + openPetitions.length);

            openPetitions.forEach(function(petition) {
                multi.sismember(openPetitionsKey, petition.id);
            });
            
            // Execute the list of sadd operations
            multi.exec(function(err, replies) {
                callback(err, replies, openPetitions);
            });
        }, // 3. Checks return values from sismember operation and posts new responses.
        function (replies, openPetitions, callback) {
            console.log('In postOpenPetitions');
            // For each response, a value of 1 means it is new
            // In that case, share on social media
            for(var i = 0; i < replies.length; i++) {
                if (replies[i] == 0 /* 0 means NOT already in DB */) {
                    console.log('NEW Petitions: ' + openPetitions[i].id + ' - ' + openPetitions[i].title);
                    // post to social media?
                    var petition = openPetitions[i];
                    facebookOpenPetition(petition);
                    tumblrOpenPetition(petition);
                    tweetOpenPetition(petition);
                    client.sadd(openPetitionsKey, openPetitions[i].id);
                    break;
                }
            }
            callback(null);
        }], function (err) {
            outerCallback(err, 'OpenPetitionWaterfall');
        }
    );
}

// Parsing Helpers

/**
 * @param {object} respondedPetitions - Same format as the Whitehouse API
 * https://petitions.whitehouse.gov/developers#petitions-retrieve
 * @returns [{ id:string, url: string, time: string, petitions: string[]}]
 */
function parseResponses(respondedPetitions) {
    var responses = Object.create({});
    respondedPetitions.forEach(function(petition) {
        var responseId = petition.response.id;
        if (!responses[responseId]) {
            responses[responseId] = Object.create({id: petition.response.id, url: petition.response.url, petitions: [], time: petition.response.associationTime});
        }
        responses[responseId].petitions.push('"' + petition.title + '"');
    });
    var sortedIds = Object.keys(responses).sort(function(a, b) {
        return responses[a].time - responses[b].time;
    });
    return sortedIds.map(function(id) { return responses[id] });
}

function sanitizeText(text) {
    return text.replace('&amp;', '&');
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

function tweet(prefix, title, url) {
    // This snippet trims the title to be appropriate for tweet.
    // The overhead for a tweet is the the prefix (e.g. "NEW RESPONSE: "), URL, the hashtags, and the space between the text, url, and hashtags.
    // This takes that into account and trims the title if necessary to keep tweets under 140 characters.
    title = sanitizeText(title);
    var maxTitleLength = 140 - (Math.min(process.env.TWITTER_URL_LENGTH || 25, url.length) + prefix.length + twitterHashtags.length + 2 /* num spaces */);
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
 * @param { id:string, url: string, time: string, petitions: string[]} response
 */
function tweetReponse(response) {
    tweet('New Response: ', response.petitions[0], response.url);
}

// Tumblr Variables & Initialization
var tumblrTags = 'We The People,White House Petitions,Petitions,Change,Democracy';
var tumblr = Tumblr.createClient(
    {
        consumer_key: process.env.TUMBLR_CONSUMER_KEY,
        consumer_secret: process.env.TUMBLR_CONSUMER_SECRET,
        token: process.env.TUMBLR_ACCESS_TOKEN,
        token_secret: process.env.TUMBLR_ACCESS_SECRET
    }
);

function tumblrPost(postTitle, postDescription, postUrl) {
    tumblr.link(process.env.TUMBLR_BLOG_URL, {title: sanitizeText(postTitle), description: sanitizeText(postDescription), url: postUrl, tags: tumblrTags}, function(err, json) {
        if (err) {
            console.error('Error posting to Tumblr');
            console.error(err);
        } else {
            console.log('Posted to Tumblr: ' + postTitle);
        }
    });
}

function tumblrOpenPetition(openPetition) {
    tumblrPost("New petition: " + openPetition.title, openPetition.body, openPetition.url);
}

/**
 * @param  { id:string, url: string, time: string, petitions: string[]} response
 */
function tumblrNewResponse(response) {
    var title = '';
    var body = '';
    if (response.petitions.length == 1) {
        title = 'We did it! The White House just issued a response to ' + response.petitions[0];
    } else {
        title = 'We did it! The White House just issued a response to ' + response.petitions.length + ' petitions';
        body = response.petitions.join("\n");
    }
    tumblrPost(title, body, response.url);
}


// Facebook Methods
function facebookPost(text, url) {
    fb.api('/' + process.env.FACEBOOK_PAGE_ID + '/feed', 'post', { message: sanitizeText(text), link: url}, function (res) {
        if(!res || res.error) {
            console.log(!res ? 'error occurred' : res.error);
            return;
        }
        console.log('Posted to FB: ' + res.id);
    });
}

function facebookOpenPetition(openPetition) {
    facebookPost('New petition: ' + openPetition.title + '\n\n' + openPetition.body, openPetition.url);
}

/**
 * @param { id:string, url: string, time: string, petitions: string[]} response
 */
function facebookNewResponse(response) {
    var message = '';
    if (response.petitions.length == 1) {
        message = 'We did it! The White House has issued a response to ' + response.petitions[0];
    } else {
        message = 'We did it! The White House has issued a response to ' + response.petitions.length + ' petitions:' + "\n-" + response.petitions.join("\n-");
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