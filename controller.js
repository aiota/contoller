var aiota = require("aiota-utils");
var express = require("express");
var cookieParser = require("cookie-parser");
var methodOverride = require("method-override");
var http = require("http");
var MongoClient = require("mongodb").MongoClient;
var config = require("./config");

var db = null;

function sendGETResponse(request, response, data)
{
	var callback = request.query.callback;
	
	if (callback && (callback != "undefined")) {
		// This is a JSONP request
		response.contentType("text/javascript");
		response.send(callback + "(" + JSON.stringify(data) + ");");
	}
	else {
		response.contentType("json");
		response.send(data);
	}
}

function launchMicroProcesses()
{
	var procs = [
		// We always start the AiotA console
		{ script: "console.js", module: "aiota-console", description: "Management Console", maxRuns: 3, instances: 1 }
	];
	
	procs.push({ script: "ingestion.js", module: "aiota-ingestion", description: "Ingestion API", maxRuns: 3, instances: 1 });
	procs.push({ script: "register.js", module: "aiota-register", description: "Device Registration Process", maxRuns: 3, instances: 1 });
	procs.push({ script: "session.js", module: "aiota-session", description: "Session Provisioning Process", maxRuns: 3, instances: 1 });
	procs.push({ script: "longpolling.js", module: "aiota-longpolling", description: "Long Polling Process", maxRuns: 3, instances: 2 });
	procs.push({ script: "response.js", module: "aiota-response", description: "Response Message Process", maxRuns: 3, instances: 1 });
	procs.push({ script: "telemetry.js", module: "aiota-telemetry", description: "Telemetry Message Process", maxRuns: 3, instances: 1 });

	for (var i = 0; i < procs.length; ++i) {
		var proc = {
				launchingProcess: "aiota-controller",
				serverName: "localhost",
				directory: "/usr/local/lib/node_modules/aiota/node_modules",
				module: procs[i].module,
				script: procs[i].script,
				maxRuns: procs[i].maxRuns,
				description: procs[i].description,
				logFile: "/var/log/aiota/aiota.log"
		};
		
		// Start the configured number of instances of this micro process
		for (var j = 0; j < procs[i].instances; ++j) {
			aiota.startProcess(db, proc);
		}
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

// GET requests
app.get("/api/action", function(request, response) {
	switch (request.query.type) {
	case "restart":		aiota.restartProcess(request.query.process, config.serverName, parseInt(request.query.pid, 10), db);
						break;
	case "stop":		aiota.stopProcess(request.query.process, config.serverName, parseInt(request.query.pid, 10), db);
						break;
	case "kill":		aiota.killProcess(parseInt(request.query.pid, 10));
						break;
	}

	sendGETResponse(request, response, { success: true });	
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
			aiota.terminateProcess(config.processName, config.serverName, db, function() {
				db.collection("running_processes", function(err, collection) {
					if (err) {
						createLog(config.processName, config.serverName, db, err);
						process.exit(1);
						return;
					}
			
					var pids = [];
					
					var stream = collection.find({ server: config.serverName, status: "running" }, { pid: 1 }).stream();
					
					stream.on("error", function (err) {
						createLog(config.processName, config.serverName, db, err);
					});
			
					stream.on("data", function(doc) {
						pids.push(doc.pid);
					});
			
					stream.on("end", function() {
						for (var i = 0; i < pids.length; ++i) {
							aiota.killProcess(pids[i]);
						}
				
						process.exit(1);
					});
				});
			});
		});
	}
});
