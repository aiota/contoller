var aiota = require("aiota-utils");
var express = require("express");
var cookieParser = require("cookie-parser");
var methodOverride = require("method-override");
var http = require("http");
var MongoClient = require("mongodb").MongoClient;
var config = require("./config");

var db = null;

function sendPOSTResponse(response, data)
{
	response.contentType("json");
	response.send(data);
}

function launchMicroProcesses()
{
	var procs = [];

	// We always start the AiotA console
	var proc = {
			launchingProcess: "aiota-controller",
			serverName: "localhost",
			directory: "/usr/local/lib/node_modules/aiota/node_modules",
			module: "aiota-console",
			script: "console.js",
			maxRuns: 3,
			description: "AiotA Management Console",
			logFile: "/var/log/aiota/aiota.log"
		};

	procs.push(proc);
	
	for (var i = 0; i < procs.length; ++i) {
		aiota.startProcess(db, proc);
	}
}

function bodyParser(request, response, next)
{
	if (request._body) {
		next();
		return;
	}

	if (request.method == "POST") {
		response.setHeader("Access-Control-Allow-Origin", "*");
	}
	
	request.body = request.body || {};
	
	// Check Content-Type
	var str = request.headers["content-type"] || "";
	var contentType = str.split(';')[0];
  
  	if (contentType != "text/plain") {
		return next();
	}
	
	// Flag as parsed
	request._body = true;
	
	var buf = "";
	
	request.setEncoding("utf8");
	
	request.on("data", function (chunk) {
		buf += chunk
	});
	
	request.on("end", function () {	
		try {
			request.body = JSON.parse(buf);
			next();
		}
		catch (err) {
			err.body = buf;
			err.status = 400;
			next(err);
		}
	});
}

var app = express();

app.use(cookieParser());
app.use(bodyParser);
app.use(methodOverride());
app.use(express.static(__dirname + "/public"));

// POST requests
app.post("/start", function(request, response) {
});

MongoClient.connect("mongodb://" + config.database.host + ":" + config.database.port + "/" + config.database.name, function(err, dbConnection) {
	if (err) {
		aiota.log(config.processName, config.serverName, null, err);
	}
	else {
		db = dbConnection;
		http.createServer(app).listen(config.port);
		
		launchMicroProcesses();

		setInterval(function() { aiota.heartbeat(config.processName, config.serverName, db); }, 10000);

		process.on("SIGTERM", function() {
			aiota.terminateProcess(config.processName, config.serverName, db);
			process.exit(1);
		});
	}
});
