/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50, node: true */
/*global */

(function () {
    "use strict";
    
    var os = require("os"),
        execFile = require("child_process").execFile,
        spawn = require("child_process").spawn;
    
    var isWindows = /^win/.test(process.platform);

    var DOMAIN_NAME = "elixirIex";
    var _domainManager = null;
    
    /** A map that contains all repl childprocesses that we are owning */
    var repls = {};
    
    function randomReplId() {
        return Math.floor(Math.random() * 9999);
    }

    function runProcess(procName, args, workingDirectory, cb) {
        // console.info("Running process", procName, args, workingDirectory);
        execFile(procName, args, { cwd: workingDirectory },
            function (err, stdout, stderr) {
                stdout = stdout || "";
                stderr = stderr || "";
                if (stderr || stdout || !err) {
                    cb(null, {stdout: stdout, stderr: stderr});
                } else {
                    console.error("Error running a subprocess: ", err);
                    cb(err, null);
                }
            });
    }
    
    function startRepl(procName, args, workingDirectory) {
        // Generate an ID for the repl to be able to identify it later
        var newId = 0;
        while (true) {
            newId = randomReplId();
            if (!repls[newId]) { break; }
        }
        
        var proc = spawn(procName, args, { cwd: workingDirectory});
        var replInfo = {
            id: newId,
            isAlive: true,
            proc: proc
        };
        
        proc.stdout.setEncoding("utf8");
        proc.stdout.on("data", function (data) {
            _domainManager.emitEvent(DOMAIN_NAME, "replDataAvailable", [
                newId, { stdout: data }]);
        });
        proc.stderr.setEncoding("utf8");
        proc.stderr.on("data", function (data) {
            _domainManager.emitEvent(DOMAIN_NAME, "replDataAvailable", [
                newId, { stderr: data }]);
        });
        proc.on("close", function (code, signal) {
            // console.info("proc exited with code: ", code, signal);
            // We only send an event if we didn't close the process on purpose
            if (replInfo.isAlive) {
                replInfo.isAlive = false;
                delete repls[newId];
                _domainManager.emitEvent(DOMAIN_NAME, "replClosed", [newId]);
            }
        });
        proc.on("error", function (err) {
            console.error("Error in the REPL subprocess: ", err);
            _domainManager.emitEvent(DOMAIN_NAME, "replError", [newId, err]);
        });
        
        repls[newId] = replInfo;
        return newId; // Return the repl ID
    }
    
    function sendReplData(replId, data) {
        // console.info("Send repl data: ", data);
        var replInfo = repls[replId];
        if (!replInfo) { return; }
        replInfo.proc.stdin.write(data);
        return;
    }
    
    function killChildProcess(procInfo) {
        //console.info("killing process " + procInfo.proc.pid);
        // Check if already killed
        if (!procInfo.isAlive) { return; }
        procInfo.isAlive = false;
        
        if (isWindows) {
            // Kill child processes via taskkill, as node.js kill doesn't work reliably
            execFile("taskkill",
                     ["/PID", procInfo.proc.pid, "/T", "/F"],
                     { },
                     function (err, stdout, stderr) {
                        /* console.info("killed: ", err, stdout, stderr); */
                });
        } else {
            procInfo.proc.kill("SIGTERM");
        }
    }
    
    function closeRepl(replId) {
        var replInfo = repls[replId];
        if (!replInfo) { return; }
        delete repls[replId];
        // Kill the process
        killChildProcess(replInfo);
        return true;
    }
    
    function closeAllRepls() {
        //console.info("Closing all repls");
        var id;
        for (id in repls) {
            if (repls.hasOwnProperty(id)) {
                killChildProcess(repls[id]);
            }
        }
        repls = {};
    }
    
    /**
     * Initializes the IexDomain
     * @param {DomainManager} domainManager The DomainManager for the server
     */
    function init(domainManager) {
        if (!domainManager.hasDomain(DOMAIN_NAME)) {
            domainManager.registerDomain(DOMAIN_NAME, {major: 0, minor: 1});
        }
        _domainManager = domainManager;

        domainManager.registerCommand(
            DOMAIN_NAME,       // domain name
            "runProcess",      // command name
            runProcess,        // command handler function
            true,              // async
            "runs a process with given arguments and returns it's output",
            [{
                name: "procName",
                type: "string",
                description: "The name of the process to run"
            }, {
                name: "args",
                type: "[string]",
                description: "An array of commandline arguments for the process"
            }, {
                name: "workingDirectory",
                type: "string",
                description: "The working directory for the process"
            }],
            [{
                name: "procOutput", // return values
                type: "{stdout:string, stderr:string}",
                description: "stdout and stderr of the process"
            }]
        );
        
        domainManager.registerCommand(
            DOMAIN_NAME,       // domain name
            "startRepl",       // command name
            startRepl,         // command handler function
            false,             // sync
            "Starts a new repl session. Returns the repls ID",
            [{
                name: "procName",
                type: "string",
                description: "The name of the process to run"
            }, {
                name: "args",
                type: "[string]",
                description: "An array of commandline arguments for the process"
            }, {
                name: "workingDirectory",
                type: "string",
                description: "The working directory for the process"
            }],
            [{
                name: "replId", // return values
                type: "int",
                description: "Id for the new repl"
            }]
        );
        
        domainManager.registerCommand(
            DOMAIN_NAME,       // domain name
            "sendReplData",    // command name
            sendReplData,      // command handler function
            false,             // sync
            "Send data to a repl session",
            [{
                name: "replId",
                type: "int",
                description: "The ID of the repl to which data should be sent"
            }],
            []
        );
        
        domainManager.registerCommand(
            DOMAIN_NAME,       // domain name
            "closeRepl",       // command name
            closeRepl,         // command handler function
            false,             // sync
            "Closes a repl session.",
            [{
                name: "replId",
                type: "int",
                description: "The ID of the repl to close"
            }],
            [{
                name: "replWasClosed", // return values
                type: "bool",
                description: "Whether the repl was closed. True if yes, false otherwise"
            }]
        );
        
        domainManager.registerCommand(
            DOMAIN_NAME,       // domain name
            "closeAllRepls",   // command name
            closeAllRepls,     // command handler function
            false,             // sync
            "Closes all active repl sessions",
            [],
            []
        );
        
        domainManager.registerEvent(
            DOMAIN_NAME,
            "replDataAvailable",
            [{
                name: "replId",
                type: "int",
                description: "The ID of the REPL which received data"
            }, {
                name: "data",
                type: "Object",
                description: "The new data which is available"
            }]
        );
        
        domainManager.registerEvent(
            DOMAIN_NAME,
            "replClosed",
            [
                {   name: "replId",
                    type: "int",
                    description: "The ID of the REPL that was closed" }
            ]
        );
        
        domainManager.registerEvent(
            DOMAIN_NAME,
            "replError",
            [{
                name: "replId",
                type: "int",
                description: "The ID of the REPL that was closed"
            }, {
                name: "error",
                type: "Object",
                description: "The error that occured"
            }]
        );
    }
    
    exports.init = init;
    
}());