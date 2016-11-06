/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


/*
 * In the search pane of about:preferences, the hbox containing contextual
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

    get SearchEngines() {
        delete this.SearchEngines;
        Cu.import("chrome://xseei/content/modules/SearchEngines.jsm", this);
        return this.SearchEngines;
    },

    get exportSelectedButton() {
        delete this.exportSelectedButton;
        return this.exportSelectedButton = document.getElementById(
                                                    "xseei-export-selected");
    },

    ////////////////////////////////////////////////////////////////////////////

    handleEvent: function(event) {
        switch (event.type) {
            case "select":
                if (event.target.id === "engineList")
                    this.onTreeSelect();
                break;
        }
    },


    onTreeSelect() {
        this.exportSelectedButton.disabled = gEngineView.selectedIndex == -1;
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
        // Build the filename offered as default in the filepicker
        let filename = this.prefs.getComplexValue("exportAll.defaultFileName",
                                                  Ci.nsISupportsString).data
                       || this.defaultPrefs.getCharPref(
                                                "exportAll.defaultFileName");
        let now = new Date();
        // toLocaleFormat expects the same format as strftime() in C:
        //   http://pubs.opengroup.org/onlinepubs/007908799/xsh/strftime.html
        filename = now.toLocaleFormat(filename).replace(/\//gm, "-");

        if (!filename.endsWith(".zip"))
            filename += ".zip";


        let fp = Cc["@mozilla.org/filepicker;1"]
                    .createInstance(Ci.nsIFilePicker);

        fp.init(window,
                this.strings.getString("exportAllDialogTitle"),
                Ci.nsIFilePicker.modeSave);
        fp.appendFilter(this.strings
                            .getString("exportAllDialog.zipFilter.title"),
                        "*.zip");
        fp.defaultString = filename;
        fp.defaultExtension = "zip";
        fp.open({
            done: result => {
                if (result === Ci.nsIFilePicker.returnCancel)
                    return;

                let engines = Services.search.getVisibleEngines();

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
                    let file = files.getNext().QueryInterface(Ci.nsILocalFile);
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
                    }).catch(Cu.reportError);  // Report each engine separately
                });

                sequence.then(() => {
                    // Do something with importedEngines; nothing for now
                });
            }
        });
    }
};


window.addEventListener("select", xseei, false);
