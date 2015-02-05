var redis = require('redis');
var url = require('url');
var redisURL = url.parse(process.env.REDISCLOUD_URL || 'redis://127.0.0.1:6379');
var client = redis.createClient(redisURL.port, redisURL.hostname, {no_ready_check: true});
if (!process.env.LOCAL == true) {
    client.auth(redisURL.auth.split(":")[1]);
}

var respondedPetitionsKey = 'respondedPetitions';
var openPetitionsKey = 'openPetitions';

var clearDB = function (data) {
    var multi = client.multi();
    multi.del(respondedPetitionsKey);
    multi.del(openPetitionsKey);
    multi.exec(function (err, replies) {
        if (err) {
            console.log(err);
        } else {
            var sum = 0;            
            replies.forEach(function (reply, index) {
                sum += reply;
            });
            console.log(sum + ' elements were deleted');
        }
        client.quit();
    });
}

clearDB();