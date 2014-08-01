/*jslint vars: true, plusplus: true, devel: true, nomen: true, regexp: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, window */

/** Simple extension that lets you add file type mappings to languages */
define(function (require, exports, module) {
    "use strict";
    require('elixir');
    var LanguageManager = brackets.getModule("language/LanguageManager");
    LanguageManager.defineLanguage("elixir", {
        name: "Elixir",
        mode: "elixir",
        fileExtensions: ["exs", "ex"],
        fileNames: ["mix.lock"],
        lineComment: ["#"]
    });
});
