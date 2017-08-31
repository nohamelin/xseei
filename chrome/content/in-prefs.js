/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


/*
 * In the search pane of about:preferences (general pane instead, after the
 * options re-arrangenment landed in Fx 55), the hbox containing contextual
 * actions for the selected engine does not have an id, so we can't overlay it.
 * Instead, we do it programmatically.
 */
document.addEventListener("Initialized", function onInitialized() {
    document.removeEventListener("Initialized", onInitialized);

    let removeEngineButton = document.getElementById("removeEngineButton");
    if (!removeEngineButton)
        return;

    let containerBox = removeEngineButton.parentNode;
    if (!containerBox || containerBox.nodeName !== "hbox")
        return;

    let exportEngineButton = document.getElementById("xseei-export-selected");
    containerBox.insertBefore(exportEngineButton, removeEngineButton);
    exportEngineButton.hidden = false;
});



var xseei = {

    get prefs() {
        delete this.prefs;
        return this.prefs = Services.prefs.getBranch("extensions.xseei.");
    },

    get defaultPrefs() {
        delete this.defaultPrefs;
        return this.defaultPrefs = Services.prefs.getDefaultBranch(
                                                    "extensions.xseei.");
    },

    get strings() {
        delete this.strings;
        return this.strings = document.getElementById("xseei-strings");
    },

    exportSelectedButton: null,
    exportCustomsButton: null,


    ////////////////////////////////////////////////////////////////////////////

    handleEvent(event) {
        switch (event.type) {
            case "DOMContentLoaded":
                this.onLoad();
                break;
            case "unload":
                this.onUnload();
                break;
            case "select":
                if (event.target.id === "engineList") {
                    this.onTreeSelect();
                }
                break;
        }
    },


    observe(subject, topic, data) {
        if (topic === "browser-search-engine-modified") {
            switch (data) {
                case "engine-added":
                case "engine-removed":
                    this.onEnginesCountChanged();
                    break;
            }
        }
    },


    onLoad() {
        Cu.import("chrome://xseei/content/modules/SearchEngines.jsm", this);

        this.exportSelectedButton = document.getElementById(
                                             "xseei-export-selected");
        this.exportCustomsButton = document.getElementById(
                                            "xseei-export-customs");

        this.onEnginesCountChanged();
        Services.obs.addObserver(this,
                                 "browser-search-engine-modified",
                                 false);
    },


    onUnload() {
        Services.obs.removeObserver(this,
                                    "browser-search-engine-modified",
                                    false);
    },


    onTreeSelect() {
        this.exportSelectedButton.disabled = gEngineView.selectedIndex == -1;
    },


    onEnginesCountChanged() {
        this.exportCustomsButton.disabled = !this.SearchEngines
                                                 .haveCustomEngines();
    },


    exportSelectedEngineToFile() {
        let engine = gEngineView.selectedEngine.originalEngine;

        let fp = Cc["@mozilla.org/filepicker;1"]
                    .createInstance(Ci.nsIFilePicker);

        fp.init(window,
                this.strings.getString("exportSelectedDialogTitle"),
                Ci.nsIFilePicker.modeSave);
        fp.appendFilters(Ci.nsIFilePicker.filterXML);
        fp.defaultString = this.SearchEngines.sanitizeEngineName(engine.name)
                            + ".xml";
        fp.defaultExtension = "xml";
        fp.open({
            done: result => {
                if (result === Ci.nsIFilePicker.returnCancel)
                    return;

                this.SearchEngines.saveEngineToXmlFile(engine, fp.file)
                    .catch(Cu.reportError);
            }
        });
    },


    exportAllEnginesToFile() {
        let engines = Services.search.getVisibleEngines();

        let filenamepref = "exportAll.defaultFileName";
        let filename = this.prefs.getComplexValue(filenamepref,
                                                  Ci.nsISupportsString).data
                       || this.defaultPrefs.getCharPref(filenamepref);

        let title = this.strings.getString("exportAllDialogTitle");

        this._exportEnginesToZipFile(engines, filename, title);
    },


    exportCustomEnginesToFile() {
        let engines = this.SearchEngines.getCustomEngines();

        let filenamepref = "exportNonDefaults.defaultFileName";
        let filename = this.prefs.getComplexValue(filenamepref,
                                                  Ci.nsISupportsString).data
                       || this.defaultPrefs.getCharPref(filenamepref);

        let title = this.strings.getString("exportNonDefaultsDialogTitle");

        this._exportEnginesToZipFile(engines, filename, title);
    },


    _exportEnginesToZipFile(engines, filenameFormat, filePickerTitle) {
        let now = new Date();
        // toLocaleFormat expects the same format as strftime() in C:
        //   http://pubs.opengroup.org/onlinepubs/007908799/xsh/strftime.html
        let filename = ("toLocaleFormat" in now)    // Pre Fx 57
                        ? now.toLocaleFormat(filenameFormat)
                        : filenameFormat;       // TODO: remove format chars(?)
        filename = filename.replace(/\//gm, "-");

        if (!filename.endsWith(".zip"))
            filename += ".zip";


        let fp = Cc["@mozilla.org/filepicker;1"]
                    .createInstance(Ci.nsIFilePicker);

        fp.init(window, filePickerTitle, Ci.nsIFilePicker.modeSave);
        fp.appendFilter(this.strings
                            .getString("dialogs.zipFilter.title"),
                        "*.zip");
        fp.defaultString = filename;
        fp.defaultExtension = "zip";
        fp.open({
            done: result => {
                if (result === Ci.nsIFilePicker.returnCancel)
                    return;

                this.SearchEngines.saveEnginesToZipFile(engines, fp.file)
                    .catch(Cu.reportError);
            }
        });
    },


    importEnginesFromFiles() {
        let fp = Cc["@mozilla.org/filepicker;1"]
                    .createInstance(Ci.nsIFilePicker);

        fp.init(window,
                this.strings.getString("importDialogTitle"),
                Ci.nsIFilePicker.modeOpenMultiple);
        fp.appendFilters(Ci.nsIFilePicker.filterXML);
        fp.open({
            done: result => {
                if (result === Ci.nsIFilePicker.returnCancel)
                    return;

                let xmlFiles = [];

                let files = fp.files;
                while (files.hasMoreElements()) {
                    let file = files.getNext().QueryInterface(Ci.nsIFile);
                    xmlFiles.push(file);
                }

                let importedEngines = [];
                // The use of this empty promise lets us to run sequentially
                // a group of promises, one for each engine. This process is
                // not stopped if one or more promises are rejected in between.
                let sequence = Promise.resolve();
                xmlFiles.forEach(file => {
                    sequence = sequence.then(() => {
                        return this.SearchEngines.addEngineFromXmlFile(file);
                    }).then(engine => {
                        importedEngines.push(engine);
                    }).catch(err => {  // Each engine is reported separately
                        Cu.reportError(
                            "Import of a search engine from the file '" +
                            file.leafName + "' failed: " + err.message || err);
                        // TODO: Warn directly to the user about it too. But
                        // I'm unsure how the UI should manage multiple errors.
                    });
                });
                sequence.then(() => {
                    // Ensure the last imported engine is visible and selected
                    if (importedEngines.length > 0) {
                        gEngineView.selection.select(gEngineView.lastIndex);
                        gEngineView.ensureRowIsVisible(gEngineView.lastIndex);
                        document.getElementById("engineList").focus();
                    }
                }).catch(Cu.reportError);
            }
        });
    }
};


window.addEventListener("DOMContentLoaded", xseei, false);
window.addEventListener("unload", xseei, false);
window.addEventListener("select", xseei, false);
