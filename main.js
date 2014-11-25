/*jslint vars: true, plusplus: true, devel: true, nomen: true, regexp: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, window, appshell */

/** Simple extension that lets you add file type mappings to languages */
define(function (require, exports, module) {
    "use strict";
    require('elixir');

    // Import resources
    var helpWidgetHtml     = require('text!widgets/help_inline_widget.html'),
        outputPanelHtml    = require('text!widgets/output_panel.html'),
        replPanelHtml      = require('text!widgets/repl_panel.html');

    // Import prackets modules
    var CodeHintManager    = brackets.getModule("editor/CodeHintManager"),
        CodeInspection     = brackets.getModule("language/CodeInspection"),
        CommandManager     = brackets.getModule("command/CommandManager"),
        Commands           = brackets.getModule("command/Commands"),
        DocumentManager    = brackets.getModule("document/DocumentManager"),
        EditorManager      = brackets.getModule("editor/EditorManager"),
        ExtensionUtils     = brackets.getModule("utils/ExtensionUtils"),
        FileSystem         = brackets.getModule("filesystem/FileSystem"),
        InlineWidget       = brackets.getModule("editor/InlineWidget"),
        LanguageManager    = brackets.getModule("language/LanguageManager"),
        MainViewManager    = brackets.getModule("view/MainViewManager"),
        Menus              = brackets.getModule("command/Menus"),
        NodeDomain         = brackets.getModule("utils/NodeDomain"),
        ProjectManager     = brackets.getModule("project/ProjectManager"),
        Strings            = brackets.getModule("strings"),
        WorkspaceManager   = brackets.getModule("view/WorkspaceManager"),
        PreferencesManager = brackets.getModule("preferences/PreferencesManager");

    // Setup elixir language (syntax highlighting)
    LanguageManager.defineLanguage("elixir", {
        name: "Elixir",
        mode: "elixir",
        fileExtensions: ["exs", "ex"],
        fileNames: ["mix.lock"],
        lineComment: ["#"]
    });

    /**
     * Returns whether the given document is a document
     * in elixir mode.
     * @param document {Document} The document to check
     */
    function isElixir(document) {
        if (document && document.language) {
            return document.language.getMode() === "elixir";
        }
        return false;
    }

    /** Converts plain text into valid HTML by escaping HTML special characters */
    function toHtml(text) {
        return $("<div>").text(text).html();
    }

    // Create the widgets and helper functions that we are using

    function createHelpInlineWidget(editor, pos, helpText) {
        if (!editor) { return null; }
        var widget = new InlineWidget.InlineWidget();
        var contentNode = $(helpWidgetHtml);
        contentNode.text(helpText);
        widget.$htmlContent
            .append("<br>")
            .append(contentNode);
        widget.load(editor);
        editor.addInlineWidget(pos, widget, true);
        // Adjust height to match the content
        editor.setInlineWidgetHeight(widget, widget.$htmlContent[0].scrollHeight);
        return widget;
    }

    var isIdentifierRegEx = /[\w\.]/;
    var isIdentifierNoDotRegEx = /[\w]/;

    /**
     * Returns the identifier which is below the cursor in the current document.
     * @param getMaxPossibleIdentifier {bool} If this is true then the longest
     * possible identifier will be returned. This means if the cursor is on a module
     * name but attached to the module name is also a function name both will be returned.
     * If it's set to false then only the function name will be returned.
     */
    function getIdentifierAtCurrentPosition(getMaxPossibleIdentifier) {
        var editor = EditorManager.getActiveEditor();
        if (!editor) {
            return null;
        }

        var cursorPos = editor.getCursorPos();
        var line = editor.document.getLine(cursorPos.line);
        var ident = "";

        // Start left of the cursorPos and scan what characters we already have
        var pos = cursorPos.ch - 1;
        // Search to the left and append
        while (pos >= 0) {
            var ch = line[pos];
            if (isIdentifierRegEx.test(ch)) {
                ident = ch + ident;
                pos--;
            } else if (ch === ":") {
                ident = ch + ident;
                break;
            } else {
                break;
            }
        }
        // Search to the right. Don't run over dots, because we only want to get current module
        pos = cursorPos.ch;
        while (pos < line.length) {
            var ch2 = line[pos];
            if ((getMaxPossibleIdentifier && isIdentifierRegEx.test(ch2)) ||
                    (!getMaxPossibleIdentifier && isIdentifierNoDotRegEx.test(ch2))) {
                ident = ident + ch2;
                pos++;
            } else {
                break;
            }
        }
        return ident;
    }

    /**
     * Clears the content of the given panel
     * @param panel {Panel} The panel to clear
     */
    function clearPanelContent(panel) {
        $('#content', panel.$panel).html("");
    }

    /**
     * Set the content of an output panel to the given text
     * @param panel {Panel} The panel whose content to change
     * @param text {string} The text to set as the content of the panel. Can be HTML
     */
    function setPanelContent(panel, text) {
        var content = $('#content', panel.$panel);
        content.html(text);
        content.animate({ scrollTop: content[0].scrollHeight }, "fast"); // Scroll to the bottom
        $("a[data-path]", content).click(function (ev) {
            var elem = $(ev.currentTarget);
            // Open the file
            var open =  CommandManager.execute(Commands.CMD_ADD_TO_WORKINGSET_AND_OPEN,
                                               {fullPath: elem.attr("data-path"),
                                                paneId: MainViewManager.ACTIVE_PANE,
                                                silent: true});
            open.done(function (_) {
                // Jump to the line
                var editor = EditorManager.getCurrentFullEditor();
                editor.setCursorPos(parseInt(elem.attr("data-line"), 10) - 1, 0, true);
                MainViewManager.focusActivePane();
            });
        });
        panel.show();
    }

    /**
     * Append text to a panel
     * @param panel {Panel} The panel whose content to change
     * @param text {string} The text to append to the content of the panel. Can be HTML
     */
    function appendPanelContent(panel, text) {
        var content = $('#content', panel.$panel);
        content.html(content.html() + text);
        content.animate({ scrollTop: content[0].scrollHeight }, "fast"); // Scroll to the bottom
        $("a[data-path]", content).click(function (ev) {
            var elem = $(ev.currentTarget);
            // Open the file
            var open =  CommandManager.execute(Commands.CMD_ADD_TO_WORKINGSET_AND_OPEN,
                                               {fullPath: elem.attr("data-path"),
                                                paneId: MainViewManager.ACTIVE_PANE,
                                                silent: true});
            open.done(function (_) {
                // Jump to the line
                var editor = EditorManager.getCurrentFullEditor();
                editor.setCursorPos(parseInt(elem.attr("data-line"), 10) - 1, 0, true);
                MainViewManager.focusActivePane();
            });
        });
        panel.show();
    }

    function insertFileLinks(text) {
        // Super sophisticated regex to find filenames and line numbers
        // after a closing brace
        var t = text.replace(
            /(\)\s+)(([\w\d_\+\- \.]+\/)*[\w\d_\+\- ]+\.(exs?|erl)):(\d+)/g,
            function (match, p1, filename, directory, fileending, line, offset, string) {
                // Check if our project contains this filename
                var fullPath = ProjectManager.getProjectRoot().fullPath;
                var lchar = fullPath[fullPath.length - 1];
                if (lchar !== "\\" && lchar !== "/") {
                    fullPath += "/"; // Append a path seperator
                }
                fullPath += filename;
                var r = p1;
                r += "<a href=\"#\" ";
                r += "data-path=\"" + fullPath;
                r += "\" data-line=\"" + line + "\">"; // elixir lines are 1-based
                r += filename + ":" + line + "</a>";
                return r;
            }
        );
        return t;
    }

    /**
     * Creates an output panel from the output_panel.html template
     * @param template {string} The template to use for the panel
     * @param panelId {string} The id which should be assigned to the new panel
     * @param panelNodeId {string} The id which should be assigned
     * to the DOM element of the panel
     * @param title {string} The title for the new panel
     * @return {Panel} The new panel
     */
    function makePanel(template, panelId, panelNodeId, title) {
        var panelNode = $(template);
        panelNode.attr("id", panelNodeId);
        $('.title', panelNode).html(title);
        var newPanel = WorkspaceManager.createBottomPanel(panelId, panelNode, 300);
        $('#hide', newPanel.$panel).click(function () {
            newPanel.hide();
        });
        $("#clear", newPanel.$panel).click(function () {
            clearPanelContent(newPanel);
        });
        return newPanel;
    }

    // Create a panel for REPL functionality
    var replPanel = makePanel(replPanelHtml, "brackets-elixir-tools-repl",
        "brackets-elixir-tools-repl-panel", "Elixir - REPL");

    // Create an output panel for mix operations
    var mixOutputPanel = makePanel(outputPanelHtml, "brackets-elixir-tools-output",
        "brackets-elixir-tools-output-panel", "Elixir - Output");

    // Define the extension specific preferences
    var prefs = PreferencesManager.getExtensionPrefs("brackets-elixir-tools");

    // Setup elixir path, from which iex and mix pathes are derived
    var elixirPath = prefs.get("elixirPath");
    // Store initial value for an elixir path if it is not defined (first run)
    if (elixirPath === undefined || elixirPath === null) {
        elixirPath = "";
        prefs.set("elixirPath", elixirPath);
        prefs.save();
    }

    // Option whether to automatically run mix compile if any project file was saved
    var onSaveRunMixCompile = prefs.get("onSaveRunMixCompile");
    // Store initial value for the option if it is not defined (first run)
    if (onSaveRunMixCompile === undefined || onSaveRunMixCompile === null) {
        onSaveRunMixCompile = true;
        prefs.set("onSaveRunMixCompile", onSaveRunMixCompile);
        prefs.save();
    }

    // Option whether to automatically run mix test if any project file was saved
    var onSaveRunMixTest = prefs.get("onSaveRunMixTest");
    // Store initial value for the option if it is not defined (first run)
    if (onSaveRunMixTest === undefined || onSaveRunMixTest === null) {
        onSaveRunMixTest = true;
        prefs.set("onSaveRunMixTest", onSaveRunMixTest);
        prefs.save();
    }

    // Option to configure whether to automatically recompile saved files in an active REPL
    var onSaveCompileInRepl = prefs.get("onSaveCompileInRepl");
    // Store initial value for the option if it is not defined (first run)
    if (onSaveCompileInRepl === undefined || onSaveCompileInRepl === null) {
        onSaveCompileInRepl = true;
        prefs.set("onSaveCompileInRepl", onSaveCompileInRepl);
        prefs.save();
    }

    // Reload preferences on change
    prefs.on("change", function () {
        elixirPath = prefs.get("elixirPath");
        onSaveCompileInRepl = prefs.get("onSaveCompileInRepl");
        onSaveRunMixCompile = prefs.get("onSaveRunMixCompile");
        onSaveRunMixTest    = prefs.get("onSaveRunMixTest");
    });

    /** Creates an empty (non-elixir) project */
    function createProjectInfo() {
        return {
            isElixir: false,
            mixFile: null
        };
    }

    var currentProject = createProjectInfo();

    function isElixirProject() {
        return currentProject.isElixir === true;
    }

    /** Returns the full path of an elixir executable (like mix or iex). */
    function elixirExecutable(executable) {
        // On windows we have to append .bat, otherwise node subprocess doesn't work
        var c = (appshell && appshell.platform === 'win') ? (executable + ".bat") : executable;
        var p = elixirPath;
        if (p && p.length && p.length > 0) { // Elixir path is not empty. Attach command behind it
            // Check if we need to append a directory seperator
            if (p[p.length - 1] !== '/' && p[p.length - 1] !== '\\') {
                return p + '/' + c;
            } else {
                return p + c;
            }
        } else {
            return c;
        }
    }

    /** Dictionary which contains all active repls. Key is the name of the repl */
    var activeRepls = {};
    /** An array which contains the history of all commands which were typed into the repl */
    var replHistory = [];
    var replHistoryIndex = -1;

    function newReplState(replName) {
        return {
            name: replName,
            state: "connecting",
            id: -1, // Default ID if not yet connected,
            lastChars: "", // Contains the last 10 chars that were read from the REPL
            showsPrompt: false
        };
    }

    function getReplById(replId) {
        var repl = null;
        Object.getOwnPropertyNames(activeRepls).some(function (replName) {
            if (activeRepls[replName].id === replId) {
                repl = activeRepls[replName];
                return true;
            }
            return false;
        });
        return repl;
    }

    /**
     * Returns whether a repl with the given identifier is active and connected
     * @param replName {string} The name of the repl to check
     */
    function isReplActive(replName) {
        return activeRepls[replName] && activeRepls[replName].state === "connected";
    }

    // Connect to node process
    var iexDomain = new NodeDomain("elixirIex",
                                   ExtensionUtils.getModulePath(module, "node/iexDomain"));

    function runProcess(procName, args, workingDirectory) {
        return iexDomain.exec("runProcess", procName, args, workingDirectory);
    }

    // Only allow to run mix task at a time
    var mixTaskRunning = false;

    function runMixTask(task, projectPath) {
        if (mixTaskRunning || !currentProject.isElixir) { return; }
        runProcess(elixirExecutable("mix"), [task], projectPath)
            .done(function (result) {
                clearPanelContent(mixOutputPanel);
                if (result.stdout) {
                    setPanelContent(mixOutputPanel, insertFileLinks(toHtml(result.stdout)));
                } else if (result.stderr) {
                    setPanelContent(mixOutputPanel, insertFileLinks(toHtml(result.stderr)));
                }
                mixTaskRunning = false;
            }).fail(function (err) {
                setPanelContent(mixOutputPanel, toHtml(err));
                mixTaskRunning = false;
            });
        mixTaskRunning = true;
    }

    var currentSysReplCommand = null;

    function failCurrentSysReplCommand(error) {
        if (!currentSysReplCommand) { return; }
        var c = currentSysReplCommand;
        currentSysReplCommand = null;
        if (c.timer) {
            clearTimeout(c.timer);
            c.timer = null;
        }
        c.deferred.reject(error);
    }

    function startRepl(procName, args, workingDirectory) {
        return iexDomain.exec("startRepl", procName, args, workingDirectory);
    }

    function sendReplData(repl, data) {
        repl.showsPrompt = false;
        return iexDomain.exec("sendReplData", repl.id, data);
    }

    function closeRepl(repl) {
        return iexDomain.exec("closeRepl", repl.id);
    }

    function closeAllRepls() {
        var replName;
        for (replName in activeRepls) {
            if (activeRepls.hasOwnProperty(replName)) {
                var repl = activeRepls[replName];
                repl.state = "disconnected";
            }
        }
        activeRepls = {};
        failCurrentSysReplCommand(new Error("REPL closed"));
        return iexDomain.exec("closeAllRepls");
    }

    function tryStartSysRepl() {
        if (activeRepls.system) { return; }
        var newRepl = newReplState("system");
        activeRepls.system = newRepl;
        currentSysReplCommand = null;
        // console.info("sys repl connecting");
        startRepl(elixirExecutable("iex"), ["-S", "mix"], ProjectManager.getProjectRoot().fullPath)
            .done(function (replId) {
                newRepl.id = replId;
                if (newRepl.state === "connecting") {
                    newRepl.state = "connected";
                    // console.info("sys repl connected");
                } else if (newRepl.state === "disconnected") {
                    // We were shut down before connect finished
                    closeRepl(newRepl); // Shut down now
                }
            });
    }

    function closeSysRepl() {
        if (!activeRepls.system) { return; }
        activeRepls.system.state = "disconnected";
        if (activeRepls.system.id !== -1) {
            closeRepl(activeRepls.system);
        }
        delete activeRepls.system;
        // console.info("sys repl disconnected");
        failCurrentSysReplCommand(new Error("REPL closed"));
    }

    function runOnSystemRepl(commandName, command, projectPath) {
        var defer = $.Deferred();

        // We are busy or have no REPL. Return an empty string
        if (!isReplActive("system") || !activeRepls.system.showsPrompt || currentSysReplCommand) {
            defer.resolve("");
            return defer;
        }

        currentSysReplCommand = {
            name: commandName,
            buffer: "",
            deferred: defer,
            timer: null
        };

        sendReplData(activeRepls.system, command);

        currentSysReplCommand.timer = setTimeout(function () {
            // Repl doesn't seem to respond. Kill and restart it
            // This will also mark the promise as failed
            closeSysRepl();
            if (currentProject.isElixir) {
                tryStartSysRepl();
            }
        }, 10000);

        return defer;
    }

    function getHelpForExpression(expr, projectPath) {
        var command = "h(" + expr + ")\n";
        return runOnSystemRepl("help", command);
    }

    function getCompletionsForExpression(expr, projectPath) {
        var command = "inspect(((fn({a, b, c}) -> [to_string(a), to_string(b), Enum.map(c, &(to_string &1))] end)." +
            "(IEx.Autocomplete.expand(Enum.reverse('" + expr + "')))), limit: 9999)\n";
        return runOnSystemRepl("autocomplete", command);
    }


    var emptyCompletionsObj = {
        hints: [],
        match: "",
        selectInitial: true,
        handleWideResults: true
    };

    function stripQuote(text) {
        while (text.length > 0 && (text[0] === " " || text[0] === "\"")) {
            text = text.substr(1);
        }
        while (text.length > 0 && (text[text.length - 1] === " " || text[text.length - 1] === "\"")) {
            text = text.substr(-1);
        }
        return text;
    }

    // Define a CodeHintProvider for Elixir which gets hints through the system REPL
    var ElixirCodeHintProvider = {
        insertHintOnTab: true
    };

    ElixirCodeHintProvider.hasHints = function (editor, implicitChar) {
        // We can deliver hints when we have a REPL
        return isReplActive("system");
    };

    ElixirCodeHintProvider.getHints = function (implicitChar) {
        var defer = $.Deferred();
        var editor = EditorManager.getActiveEditor();
        // We need a REPL in order to provide hints
        if (!editor || !isReplActive("system")) {
            return null;
        }

        var cursorPos = editor.getCursorPos();
        var line = editor.document.getLine(cursorPos.line);
        var searchText = "";
        var startsWithColon = false;

        // Start left of the cursorPos and scan what characters we already have
        var pos = cursorPos.ch - 1;
        // Search to the left and append
        while (pos >= 0) {
            var ch = line[pos];
            if (isIdentifierRegEx.test(ch)) {
                searchText = ch + searchText;
                pos--;
            } else if (ch === ":") {
                searchText = ch + searchText;
                startsWithColon = true;
                break;
            } else {
                break;
            }
        }

        var lastDotPos = searchText.lastIndexOf(".");
        var preFixText = "";
        if (lastDotPos !== -1) {
            preFixText = searchText.substr(0, lastDotPos + 1);
        } else if (startsWithColon) {
            preFixText = ":";
        }

        // Start the async operation to get the completions
        getCompletionsForExpression(searchText, ProjectManager.getProjectRoot().fullPath)
            .done(function (resultText) {
                // Extract the result by eliminating leading and trailing whitespace, "
                // and unespacing strings
                resultText = resultText
                    .replace(/^[\s"]*/g, "")
                    .replace(/[\s"]*$/g, "")
                    .replace(/\\"/g, "\"");

                var resultObj = null;
                try {
                    resultObj = JSON.parse(resultText);
                } catch (e) { // Error in case of no valid JSON
                }

                if (!resultObj || resultObj[0] !== "yes") {
                    defer.resolve(emptyCompletionsObj); // No completions
                    return;
                }

                var hints = [];
                if (resultObj[1]) {
                    hints.push(searchText + resultObj[1]);
                } else {
                    resultObj[2].forEach(function (hint) {
                        hints.push(preFixText + hint);
                    });
                }

                // Create a jquery span object for each hint
                var jhints = hints.map(function (hint) {
                    var s = $("<span>")
                        .addClass("brackets-js-hints")
                        .data("text", hint)
                        .data("search-text", searchText)
                        .data("editor", editor)
                        .data("cursorPos", cursorPos);
                    s.append($("<span>").addClass("matched-hint").text(searchText));
                    s.append(hint.substr(searchText.length));
                    return s;
                });

                var complObj = {
                    hints: jhints,
                    match: null,
                    selectInitial: searchText !== "",
                    handleWideResults: true
                };

                defer.resolve(complObj);
            })
            .fail(function (err) {
                defer.resolve(emptyCompletionsObj);
            });

        return defer;
    };

    ElixirCodeHintProvider.insertHint = function (hint) {
        // Don't insert what we already have
        var text = hint.data("text");
        var searchText = hint.data("search-text");
        var toInsert = text.substr(searchText.length);
        var cursorPos = hint.data("cursorPos");
        var editor = hint.data("editor");
        editor.document.replaceRange(toInsert, cursorPos);
        return true;
    };

    // Register our code hint provider
    CodeHintManager.registerHintProvider(ElixirCodeHintProvider, ["elixir"]);

    // Handle user input the the user REPLs input field
    $("input", replPanel.$panel).keyup(function (ev) {
        if (ev.keyCode === 13) { // Enter
            var text = $("input", replPanel.$panel).val();
            // Ignore when input field is empty or no REPL active
            if (!text || !isReplActive("user")) { return; }
            text += "\n";
            $("input", replPanel.$panel).val(""); // Clear the panel
            appendPanelContent(replPanel, toHtml(text));
            sendReplData(activeRepls.user, text);
            if (replHistory.length === 0 || replHistory[replHistory.length - 1] !== text) {
                replHistory.push(text); // Append to history
                if (replHistory.length > 100) { replHistory.shift(); } // Don't grow forever
            }
            replHistoryIndex = -1; // Reset index
        } else if (ev.keyCode === 38) { // Up
            if (replHistory.length <= 0 || replHistoryIndex === 0) { return; }
            if (replHistoryIndex === -1) {
                replHistoryIndex = replHistory.length - 1; // Last field in the history
            } else {
                replHistoryIndex--;
            }
            $("input", replPanel.$panel).val(replHistory[replHistoryIndex]);
        } else if (ev.keyCode === 40) { // Down
            if (replHistory.length <= 0 || replHistoryIndex === -1 ||
                    replHistoryIndex === (replHistory.length - 1)) {
                return;
            }
            replHistoryIndex++;
            $("input", replPanel.$panel).val(replHistory[replHistoryIndex]);
        }
    });

    // Handle clicking the connect/disconnect button of the REPL
    $("#connect", replPanel.$panel).click(function (ev) {
        if (activeRepls.user) { // We have an open repl - disconnect it
            activeRepls.user.state = "disconnected";
            if (activeRepls.user.id !== -1) {
                closeRepl(activeRepls.user);
            }
            delete activeRepls.user;
            $("#connect", replPanel.$panel).text("connect");
        } else { // Connect to a new REPL
            if (!currentProject.isElixir) { return; }
            $("#connect", replPanel.$panel).text("connecting");
            var newRepl = newReplState("user");
            activeRepls.user = newRepl;
            startRepl(elixirExecutable("iex"), ["-S", "mix"], ProjectManager.getProjectRoot().fullPath)
                .done(function (replId) {
                    newRepl.id = replId;
                    if (newRepl.state === "connecting") {
                        newRepl.state = "connected";
                        $("#connect", replPanel.$panel).text("disconnect");
                    } else if (newRepl.state === "disconnected") {
                        // We were shut down before connect finished
                        closeRepl(newRepl); // Shut down now
                    }
                });
        }
    });

    function handleUserReplDataAvailable(repl, data) {
        if (data.stdout) {
            appendPanelContent(replPanel, insertFileLinks(toHtml(data.stdout)));
        }
        if (data.stderr) {
            appendPanelContent(replPanel, insertFileLinks(toHtml(data.stderr)));
        }
    }

    function handleSystemReplDataAvailable(repl, data) {
        if (!currentSysReplCommand) { return; }
        // Append received data to buffer
        if (data.stdout) {
            currentSysReplCommand.buffer += data.stdout;
        }
        if (data.stderr) {
            currentSysReplCommand.buffer += data.stderr;
        }

        // Check whether the command is complete
        if (repl.showsPrompt) {
            var c = currentSysReplCommand;
            // Clear timer
            if (c.timer) {
                clearTimeout(c.timer);
                c.timer = null;
            }
            currentSysReplCommand = null;
            // Strip the iex prompt at the end
            var lastPromptPos = c.buffer.lastIndexOf("\niex(");
            // Resolve the promise with the received data
            c.deferred.resolve(c.buffer.substr(0, lastPromptPos));
        }
    }

    var iexPromptRegEx = /iex\(\d+\)> $/;

    $(iexDomain).on("replDataAvailable", function (evt, replId, data) {
        // Find the REPL which is related to the ID
        var repl = getReplById(replId);
        if (!repl) { return; }

        // console.info("ELIXIR REPL DATA(" + repl.name + "):", data);

        // Update the buffer of the last received characters
        if (data.stdout) {
            if (data.stdout.length >= 10) {
                repl.lastChars = data.stdout.substr(-10);
            } else { // Not enough data received
                repl.lastChars = (repl.lastChars + data.stdout).substr(-10);
            }
        }
        if (data.stderr) {
            if (data.stderr.length >= 10) {
                repl.lastChars = data.stderr.substr(-10);
            } else { // Not enough data received
                repl.lastChars = (repl.lastChars + data.stderr).substr(-10);
            }
        }
        // Check whether the REPL shows a prompt
        repl.showsPrompt = iexPromptRegEx.test(repl.lastChars);

        if (repl === activeRepls.user && repl.state === "connected") {
            handleUserReplDataAvailable(repl, data);
        } else if (repl === activeRepls.system && repl.state === "connected") {
            handleSystemReplDataAvailable(repl, data);
        }
    });

    $(iexDomain).on("replClosed", function (evt, replId) {
        // Find the REPL which is related to the ID
        var repl = getReplById(replId);
        if (!repl) { return; }
        // console.info("ELIXIR REPL CLOSED(" + repl.name + ")");
        repl.state = "disconnected";
        delete activeRepls[repl.name];
        // If it is the user visible REPL change the text
        if (repl.name === "user") {
            $("#connect", replPanel.$panel).text("connect");
        } else if (repl.name === "system") {
            // console.info("sys repl disconnected");
            failCurrentSysReplCommand(new Error("REPL closed"));
        }
    });

    $(iexDomain).on("replError", function (evt, replId, err) {
        console.error("ELIXIR REPL ERROR:", replId, err);
    });


    function handleProjectClose() {
        // Close open windows
        clearPanelContent(mixOutputPanel);
        mixOutputPanel.hide();
        closeAllRepls();
        $("#connect", replPanel.$panel).text("disconnected");
        currentProject = createProjectInfo();
    }

    function handleProjectOpen() {
        var project = currentProject;

        var root = ProjectManager.getProjectRoot();
        if (!root) { return; }

        root.getContents(function (err, fileEntries, fileStats) {
            if (project !== currentProject) { return; }
            // Check for a mix.exs file to determine whether we are in
            // an elixir project
            fileEntries.some(function (entry, index, array) {
                if (entry.isFile && entry.name === "mix.exs") {
                    project.isElixir = true;
                    project.mixFile = entry.fullPath;
                    $("#connect", replPanel.$panel).text("connect");
                    return true;
                }
            });
        });

        if (currentProject.isElixir) {
            // Start the REPL for internal usage
            tryStartSysRepl();
        }
    }

    function handleDocumentSave(ev, document) {
        if (!currentProject.isElixir || !isElixir(document)) { return; } // Hook is elixir only

        // Don't care about non-project files
        var relPath = ProjectManager.makeProjectRelativeIfPossible(document.file.fullPath);
        if (!ProjectManager.isWithinProject(document.file)) { return; }

        if (onSaveRunMixTest) {
            runMixTask("test", ProjectManager.getProjectRoot().fullPath);
        }

        // Remark: If test is running compile won't run because we only allow one task
        // However that's not bad because test includes compile
        if (onSaveRunMixCompile) {
            runMixTask("compile", ProjectManager.getProjectRoot().fullPath);
        }

        if (onSaveCompileInRepl) {
            // We need an active REPL
            if (isReplActive("user") && activeRepls.user.showsPrompt &&
                    relPath.indexOf("lib/") === 0) { // Check whether the file is in the lib folder
                // Send a compile command to the REPL
                var replCommand = "c \"" + relPath + "\"\n";
                appendPanelContent(replPanel, toHtml(replCommand));
                sendReplData(activeRepls.user, replCommand);
            }
        }

        // Try to start the system REPL if we don't have one. Maybe a problem got fixed
        if (!activeRepls.system) {
            tryStartSysRepl();
        } else if (isReplActive("system") && activeRepls.system.showsPrompt &&
                    relPath.indexOf("lib/") === 0) { // Check whether the file is in the lib folder
            // Send a compile command to the REPL
            var replCommand2 = "c \"" + relPath + "\"\n";
            sendReplData(activeRepls.system, replCommand2);
        }
    }

    // Attach events
    $(ProjectManager).on("projectOpen", handleProjectOpen);
    $(ProjectManager).on("beforeProjectClose", handleProjectClose);
    $(ProjectManager).on("beforeAppClose", function () {
        // console.info("beforeAppClose");
        handleProjectClose();
    });
    $(DocumentManager).on("documentSaved", handleDocumentSave);

    /**
     * Run lint on the current document. Reports results to the main UI. Displays
     * a gold star when no errors are found.
     */
    function lintFile(text, fullPath) {
        // Each error is: { pos:{line,ch}, endPos:?{line,ch}, message:string, type:?Type }
        // Possible error types are CodeInspection.Type.ERROR / WARNING / META
        // var err = {
        //     pos: {line: 2, ch: 0},
        //     endPos: {line: 2, ch: 5},
        //     message: "Hey, Error here!",
        //     type: CodeInspection.Type.ERROR
        // };
        var errors = [];
        var result = { errors: errors, aborted: false };
        var defer = $.Deferred();

        if (!currentProject.isElixir) {
            // If we are not in a mix project return immediatly
            defer.resolve(result);
            return defer;
        } else {
            // Return immediatly too because of not implemented
            defer.resolve(result);
            return defer;
        }
    }

    // Setup linting for Elixir
    // Register for JS files
    CodeInspection.register("elixir", {
        name: "ElixirLint",
        scanFileAsync: lintFile
    });

    // Create an Elixir menu
    var elixirMenu = Menus.addMenu("Elixir", "brackets-elixir-tools.elixirmenu");
    /** Reference to the editors context menu */
    var contextMenu = Menus.getContextMenu(Menus.ContextMenuIds.EDITOR_MENU);
    /**
     * The array of commands for the context menu.
     * Will only be added if we are in an elixir file
     */
    var contextMenuCommands = [];
    /**
     * Stores the Menu item for our divider when context menu is shown.
     * This is required to be able to remove it later.
     */
    var elixirMenuDevider = null;

    // Register elixir specific commands

    // Register commands to show/hide the output windows
    [
        {panel: mixOutputPanel, id: "toggle-mix-output-window", desc: "Show/Hide mix output window"},
        {panel: replPanel, id: "toggle-repl-window", desc: "Show/Hide REPL window"}
    ].forEach(function (elem, i, arr) {
        var command = CommandManager.register(
            "Elixir: " + elem.desc,
            "brackets-elixir-tools." + elem.id,
            function () {
                elem.panel.setVisible(!elem.panel.isVisible());
            }
        );
        elixirMenu.addMenuItem(command);
    });

    // Register mix commands
    ["compile", "test"].forEach(function (mixArgument, i, arr) {
        var command = CommandManager.register(
            "Elixir: Run mix " + mixArgument,
            "brackets-elixir-tools.mix-" + mixArgument, // command name, e.g. brackets-elixir-tools.mix-compile
            function () {
                runMixTask(mixArgument, ProjectManager.getProjectRoot().fullPath);
            }
        );
        // Put the command in the menu
        elixirMenu.addMenuItem(command);
    });

    // Command to restart the system repl. Might be necessary in case it's dead due a bad expression
    var command = CommandManager.register(
        "Elixir: Restart autocomplete/help REPL",
        "brackets-elixir-tools.restart-system-repl",
        function () {
            closeSysRepl();
            if (currentProject.isElixir) {
                tryStartSysRepl();
            }
        }
    );
    // Put the command in the menu
    elixirMenu.addMenuItem(command);

    // Register REPL related commands
    command = CommandManager.register(
        "Elixir: Send selected text to REPL",
        "brackets-elixir-tools.send-selected-text-to-repl",
        function () {
            var currentDoc = DocumentManager.getCurrentDocument();
            var editor = EditorManager.getCurrentFullEditor();
            if (!editor || !isReplActive("user")) { return; }
            var text = editor.getSelectedText();
            if (text === "") { return; }
            sendReplData(activeRepls.user, text + "\n");
        }
    );
    // Put the command in the menu
    elixirMenu.addMenuItem(command);
    contextMenuCommands.push(command);

    command = CommandManager.register(
        "Elixir: Send current file to REPL",
        "brackets-elixir-tools.send-current-file-to-repl",
        function () {
            var currentDoc = DocumentManager.getCurrentDocument();
            if (!currentDoc || !isReplActive("user")) { return; }
            var text = currentDoc.getText() + "\n";
            sendReplData(activeRepls.user, text);
        }
    );
    // Put the command in the menu
    elixirMenu.addMenuItem(command);
    contextMenuCommands.push(command);

    // Registers the command that will lookup the documenation for the identifier
    // under the cursor and display it in an inline widget
    command = CommandManager.register(
        "Elixir: Show documentation for current identifer",
        "brackets-elixir-tools.show-doc-for-identifer",
        function () {
            var editor = EditorManager.getActiveEditor();
            if (!editor || !isElixir(editor.document)) { return; }
            var currentIdentifer = getIdentifierAtCurrentPosition(false);
            var cursorPos = editor.getCursorPos();
            if (currentIdentifer === "") { return; }
            getHelpForExpression(currentIdentifer, ProjectManager.getProjectRoot().fullPath)
                .done(function (helpText) {
                    if (!helpText || editor !== EditorManager.getActiveEditor()) { return; }
                    createHelpInlineWidget(editor, cursorPos, helpText);
                });
        }
    );
    // Put the command in the menu
    elixirMenu.addMenuItem(command);
    contextMenuCommands.push(command);

    // Add context menu items depending on whether we are
    // in elixir mode or not
    $(EditorManager).on("activeEditorChange", function () {
        var editor = EditorManager.getCurrentFullEditor();
        if (!editor) { return; }
        var isElixirDoc = isElixir(editor.document);

        if (isElixirDoc && !elixirMenuDevider) {
            // Add the elixir related commands
            elixirMenuDevider = contextMenu.addMenuDivider();
            contextMenuCommands.forEach(function (command, i, a) {
                contextMenu.addMenuItem(command);
            });
        } else if (!isElixirDoc && elixirMenuDevider) {
            // Remove the elixir related commands
            contextMenu.removeMenuDivider(elixirMenuDevider.id);
            elixirMenuDevider = null;
            contextMenuCommands.forEach(function (command, i, a) {
                contextMenu.removeMenuItem(command);
            });
        }
    });
});
