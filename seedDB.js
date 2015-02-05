var request = require('request');
var redis = require('redis');
var url = require('url');
var redisURL = url.parse(process.env.REDISCLOUD_URL || 'redis://127.0.0.1:6379');
var client = redis.createClient(redisURL.port, redisURL.hostname, {no_ready_check: true});
if (!process.env.LOCAL == true) {
    client.auth(redisURL.auth.split(":")[1]);
}
var async = require('async');
var respondedPetitionsKey = 'respondedPetitions';
var openPetitionsKey = 'openPetitions';

var weThePeopleBaseUrl = 'https://api.whitehouse.gov/v1/petitions.json?limit=500';
var respondedParam = '&status=responded';
var openParam = '&status=open&isSignable=true&isPublic=true';

var respondedPetitions;
var openPetitions;

function seedDB() {
    async.waterfall([
        function (callback) {
            console.log('In getPetitionsFromAPI');
            request({uri: weThePeopleBaseUrl + respondedParam}, function (error, response, body) {
                callback(error, body); 
            });            
        }, function (data, callback) {
            console.log('In addRespondedPetitionsToDB');
            var respondedPetitions = JSON.parse(data).results;
        
            // Create a multi command object
            var multi = client.multi();
            // for each responded petition, create sadd command
            for (var i = 0; i < respondedPetitions.length; i++) {
                multi.sadd(respondedPetitionsKey, respondedPetitions[i].id);
            }
            var successes = 0;
            var failures = 0;
            // Execute the list of sadd operations
            multi.exec(function(err, replies) {
                replies.forEach(function (reply, index) {
                    if (reply == 1) {
                        successes++;
                    } else {
                        failures++;
                    }
                });
                console.log('SUCCESS: Added ' + successes + ' new responses');
                console.log('FAILURE: Did NOT add ' + failures + ' old responses');
                callback(err);
            });
        }, function (callback) {
            console.log('In getPetitionsFromAPI');
            request({uri: weThePeopleBaseUrl + openParam}, function (error, response, body) {
                callback(error, body); 
            });            
        }, function (data, callback) {
            console.log('In addOpenPetitionsToDB');
            var openPetitions = JSON.parse(data).results;
        
            // Create a multi command object
            var multi = client.multi();
            // for each responded petition, create sadd command
            for (var i = 0; i < openPetitions.length; i++) {
                multi.sadd(openPetitionsKey, openPetitions[i].id);
            }
            // Execute the list of sadd operations
            var successes = 0;
            var failures = 0;
            multi.exec(function(err, replies) {
                replies.forEach(function (reply, index) {
                    if (reply == 1) {
                        successes++;
                    } else {
                        failures++;
                    }
                });
                console.log('SUCCESS: Added ' + successes + ' new open petitions');
                console.log('FAILURE: Did NOT add ' + failures + ' old open petitions');
                callback(err);
            });
        }
    ], function(err) {
        client.quit();
        if (err) {
            console.log(err);
        }
    });
}

function setup() {
    console.log('Running Setup.js');
    seedDB();
}
setup();