// Require block -- imports all the needed libraries
var express = require('express');
var session = require('express-session');
var passport = require('passport');
var request = require('request');
var tumblrStrategy = require('passport-tumblr').Strategy;
var Tumblr = require('tumblrwks');
var app = express();

passport.serializeUser(function(user, done) {
    done(null, user);
});
passport.deserializeUser(function(obj, done) {
    done(null, obj);
});

// Initialization block
app.set('port', (process.env.PORT || 5000));
app.use(express.static(__dirname + '/public'));
app.use(session({ secret: 'SECRET' }));
app.use(passport.initialize());
app.use(passport.session());



// Add headers
app.use(function (req, res, next) {

    // Website you wish to allow to connect
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5000');

    // Request methods you wish to allow
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    // Request headers you wish to allow
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');

    // Pass to next layer of middleware
    next();
});

// TUMBLR BLOCK

// Tumblr Variables & Initialization
var TUMBLR_CONSUMER_KEY = process.env.TUMBLR_CONSUMER_KEY;
var TUMBLR_CONSUMER_SECRET = process.env.TUMBLR_CONSUMER_SECRET;
var tumblrAccessToken;
var tumblrAccessSecret;

passport.use(new tumblrStrategy({
        consumerKey: TUMBLR_CONSUMER_KEY,
        consumerSecret: TUMBLR_CONSUMER_SECRET,
        callbackURL: process.env.URL +':' + (process.env.PORT || 5000) + "/auth/tumblr/callback"
    }, function (token, tokenSecret, profile, done) {
        tumblrAccessToken = token;
        tumblrAccessSecret = tokenSecret;
        console.log('Tumblr Access Token: ' + token);
        console.log('Tumblr Access Secret: ' + tokenSecret);    
        return done(null, profile);
    }
));
// GET /tumblr
//   Use passport.authenticate() as route middleware to authenticate the
//   request. The first step in Tumblr authentication will involve redirecting
//   the user to tumblr.com. After authorization, Tumblr will redirect the user
//   back to this application at /auth/tumblr/callback
app.get('/auth/tumblr',
    passport.authenticate('tumblr'),
    function(req, res){
    // The request will be redirected to Tumblr for authentication, so this
    // function will not be called.
  });

// GET /auth/tumblr/callback
//   Use passport.authenticate() as route middleware to authenticate the
//   request. If authentication fails, the user will be redirected back to the
//   login page. Otherwise, the primary route function function will be called,
//   which, in this example, will redirect the user to the success page to 
//   display the tokens.
app.get('/auth/tumblr/callback', 
    passport.authenticate('tumblr', { failureRedirect: '/auth/tumblr' }),
    function(req, res) {
        res.redirect('/auth/tumblr/success');
    }
);

// GET /auth/tumblr/success
//   Logs the access token and secret to the console and displays it in
//   the browser for easy saving.
app.get('/auth/tumblr/success', function(req, res){
  console.log('Tumblr Access Token: ' + tumblrAccessToken + ', Tumblr Access Secret: ' + tumblrAccessSecret);
  res.send('Tumblr Access Token: ' + tumblrAccessToken + ', Tumblr Access Secret: ' + tumblrAccessSecret);
});

// GET /auth/tumblr/post
//   Simple test endpoint to post to tumblr and check that everything is set up properly
app.get('/auth/tumblr/post', function(req, res){
    postToTumblr('test', 'description', 'http://www.google.com');
    res.send('PRAY');
});

function postToTumblr(title, description, url) {
    var tumblr = new Tumblr(
        {
            consumerKey: process.env.TUMBLR_CONSUMER_KEY,
            consumerSecret: process.env.TUMBLR_CONSUMER_SECRET,
            accessToken: tumblrAccessToken,
            accessSecret: tumblrAccessSecret
        }, 'whitehousepetitions.tumblr.com'
    );

    tumblr.post('/post', {type: 'link', title: title, description: description, url: description}, function(err, json) {
        if (err) {
            console.error('Error posting to Tumblr');
            console.error(err);
        } else {
            console.log('Posted to Tumblr');
        }
    });
}

// Facebook Block

// Facebook Variables & Initialization
var FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
var FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
var FACEBOOK_PAGE_ID = process.env.FACEBOOK_PAGE_ID;
var FACEBOOK_REDIRECT_URL = process.env.FACEBOOK_REDIRECT_URL;
var facebookGraphUrl = 'https://graph.facebook.com/';
var facebookRedirectUrl = FACEBOOK_REDIRECT_URL + "auth/facebook/callback";

// GET /auth/facebook
//   Use passport.authenticate() as route middleware to authenticate the
//   request. The first step in Facebook authentication will involve
//   redirecting the user to facebook.com. After authorization, Facebook will
//   redirect the user back to this application at /auth/facebook/callback
//   
// This request uses the app ID and requests manage_posts and publish_actions
// It also requests a code as the response. This code is used in the callback
// to request a User Access Token which is then exchanged for a Page access token.
app.get('/auth/facebook', function (req, res) {
    console.log('In Auth Facebook');
    console.log('Redirect URL: ' + encodeURIComponent(facebookRedirectUrl));
    var facebookAuthStepOneUrl = "https://www.facebook.com/dialog/oauth?client_id=" + FACEBOOK_APP_ID +
          "&redirect_uri=" + encodeURIComponent(facebookRedirectUrl) + 
          "&response_type=code&scope=manage_pages,publish_actions";
    res.redirect(facebookAuthStepOneUrl);
});

// GET /auth/facebook/callback
//  Using the code received in the original request, make a second request
//  to exchange the code for the User Access Token. After receiving the
//  User Access Token, call getFacebookPageToken to make the final request
//  to get the Page Access Token
app.get('/auth/facebook/callback', function(req, res) {
    console.log('In Auth Facebook Callback');
    var code = req.param('code');
    console.log('Code is:' + code);
    var facebookAuthStepTwoUrl = "https://graph.facebook.com/oauth/access_token?client_id=" + FACEBOOK_APP_ID +
        '&redirect_uri=' + encodeURIComponent(facebookRedirectUrl) +
        '&client_secret=' + FACEBOOK_APP_SECRET + "&code=" + code

    request({uri: facebookAuthStepTwoUrl}, function(err, resp, body) {
        console.log('In Auth Step Two callback');
        if (err) {
            console.log(err);
        }        
        var userAccessToken = body.split('=')[1]
        console.log('User Access Token: ' + userAccessToken);
        console.log(getFacebookPageToken(userAccessToken, FACEBOOK_PAGE_ID, res));
    });
});

// Using the User Access Token returned to the callback, make a final
// request to get the Page Access Token needed to post to facebook pages.
// There will be an array of pages returned, make sure you are getting the
// right one.
function getFacebookPageToken (userToken, pageId, response) {
    console.log('In getFacebookToken');
    var facebookAuthStepThreeUrl = facebookGraphUrl + "me/accounts/?access_token=" + userToken;
    request({uri: facebookAuthStepThreeUrl, json:true}, function(err, resp, body) {
        console.log('In Get Page Access Token Callback');
        if (err) {
            console.log(err);
        }
        resp.body.data.forEach(function (item, index) {
            if (item.id == FACEBOOK_PAGE_ID) {
                console.log('Page Access Token: ' + item.access_token);
                response.send('Page Access Token: ' + item.access_token);
            }
        });
    });   
}

app.listen(app.get('port'), function () {
	  console.log("Node app is running at localhost:" + app.get('port'));
});