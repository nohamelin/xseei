/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var EXPORTED_SYMBOLS = [ "SearchEngines" ];


const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "FileUtils",
    "resource://gre/modules/FileUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "OS",
    "resource://gre/modules/osfile.jsm");


const OPENSEARCH_NS = "http://a9.com/-/spec/opensearch/1.1/";
const OPENSEARCH_LOCALNAME = "OpenSearchDescription";

const MOZSEARCH_NS = "http://www.mozilla.org/2006/browser/search/";
const MOZSEARCH_LOCALNAME = "SearchPlugin";

/*
 * The different available alternatives for the empty base document used to
 * serialize an engine.
 */
const OPENSEARCH_EMPTY_ENGINE_DOC = `<?xml version="1.0"?>
<${OPENSEARCH_LOCALNAME} xmlns="${OPENSEARCH_NS}" xmlns:moz="${MOZSEARCH_NS}"/>
`;
const MOZSEARCH_EMPTY_ENGINE_DOC = `<?xml version="1.0"?>
<${MOZSEARCH_LOCALNAME} xmlns="${MOZSEARCH_NS}" xmlns:os="${OPENSEARCH_NS}"/>
`;
Object.defineProperty(this, "emptyEngineDoc", {
    get: function() {
        let useMozNs = Services.prefs.getBoolPref(
                        "extensions.xseei.exporter.useMozNamespaceAsDefault");
        return useMozNs ? MOZSEARCH_EMPTY_ENGINE_DOC
                        : OPENSEARCH_EMPTY_ENGINE_DOC;
    },
    enumerable: true
});

const MAX_ENGINE_FILENAME_LENGTH = 60;


/*
 * A object encapsulating a set of utilities to deal with search engines.
 *
 * Many of these has been recovered from upstream as they were removed by bug
 * 1203167, which replaces the storage of the user-installed search engines
 * in individual xml files with the new compressed 'search.json.mozlz4' file:
 *
 *   https://bugzilla.mozilla.org/show_bug.cgi?id=1203167
 */
var SearchEngines = {

    /*
     * Returns an array of all search engines (nsISearchEngines objects)
     * installed by the user himself. It could be empty.
     */
    getCustomEngines() {
        let engines = Services.search.getVisibleEngines();
        let defaults = Services.search.getDefaultEngines();
        engines = engines.filter(e => !defaults.includes(e));

        return engines;
    },


    /*
     * Returns true if there is at least one search engine installed by the
     * user himself, false otherwise.
     */
    haveCustomEngines() {
        let engines = Services.search.getVisibleEngines();
        let defaults = Services.search.getDefaultEngines();

        return engines.some(e => !defaults.includes(e));
    },


    /*
     * A Promise-powered wrapper for the callback-based addEngine method
     * from nsIBrowserSearchService.
     */
    addEngineFromXmlFile(file) {
        return new Promise((resolve, reject) => {
            let uri = OS.Path.toFileURI(file.path);

            let searchInstallCallback = {
                onSuccess: engine => {
                    resolve(engine);
                },
                onError: errorCode => {
                    switch (errorCode) {
                        case Ci.nsISearchInstallCallback.ERROR_DUPLICATE_ENGINE:
                            reject(Error("a search engine with the included " +
                                         "name already exists"));
                            break;

                        case Ci.nsISearchInstallCallback.ERROR_UNKNOWN_FAILURE:
                        default:
                            reject(Error("unknown error"));
                            break;
                    }
                }
            };

            Services.search.addEngine(uri,
                                      Ci.nsISearchEngine.DATA_XML,
                                      "",       // iconURL
                                      false,    // confirm
                                      searchInstallCallback);
        });
    },


    saveEnginesToZipFile(engines, file) {
        return Promise.resolve().then(() => {
            if (engines.length === 0) {
                throw Error("the given engines array must not be empty");
            }

            let zw = Cc["@mozilla.org/zipwriter;1"]
                        .createInstance(Ci.nsIZipWriter);
            zw.open(file,
                    FileUtils.MODE_WRONLY | FileUtils.MODE_CREATE
                                          | FileUtils.MODE_TRUNCATE);

            let serializer = Cc["@mozilla.org/xmlextras/xmlserializer;1"]
                                .createInstance(Ci.nsIDOMSerializer);
            let converter = Cc["@mozilla.org/intl/scriptableunicodeconverter"]
                            .createInstance(Ci.nsIScriptableUnicodeConverter);
            converter.charset = "UTF-8";

            engines.forEach(engine => {
                let doc = this.serializeEngineToDocument(engine);
                let str = serializer.serializeToString(doc);
                let istream = converter.convertToInputStream(str);

                // Engines with very similar names can end with the same
                // sanitized filename; we catch these to add a proper suffix.
                let filename = this.sanitizeEngineName(engine.name);
                if (zw.hasEntry(filename + ".xml")) {
                    let candidateFilename;
                    let apparitions = 1;
                    do {
                        candidateFilename = `${filename} (${apparitions})`;
                        apparitions += 1;
                    } while (zw.hasEntry(candidateFilename + ".xml"));
                    filename = candidateFilename;
                }

                zw.addEntryStream(filename + ".xml",
                                  Date.now() * 1000,
                                  Ci.nsIZipWriter.COMPRESSION_DEFAULT,
                                  istream,
                                  false);
            });
            zw.close();
        });
    },


    saveEngineToXmlFile(engine, file) {
        return Promise.resolve().then(() => {
            let serializer = Cc["@mozilla.org/xmlextras/xmlserializer;1"]
                                    .createInstance(Ci.nsIDOMSerializer);

            let doc = this.serializeEngineToDocument(engine);
            let data = serializer.serializeToString(doc);

            let useTmpFile = Services.prefs.getBoolPref(
                                "extensions.xseei.exporter.useTemporaryFile");
            let tmpFile = useTmpFile ? file.path + ".tmp" : null;

            return OS.File.writeAtomic(file.path,
                                       data,
                                       {encoding: "utf-8", tmpPath: tmpFile});
        });
    },


    /*
     * Returns an XML document object containing the search engine data.
     *
     * SOURCE:
     *   https://hg.mozilla.org/releases/mozilla-release/file/4e188de86d86/toolkit/components/search/nsSearchService.js#l2211
     */
    serializeEngineToDocument(engine) {
        let e = engine.wrappedJSObject;

        let doc = Cc["@mozilla.org/xmlextras/domparser;1"]
                    .createInstance(Ci.nsIDOMParser)
                    .parseFromString(emptyEngineDoc, "application/xml");

        doc.documentElement.appendChild(doc.createTextNode("\n"));
        appendTextNode(doc, OPENSEARCH_NS, "ShortName", e.name);
        appendTextNode(doc, OPENSEARCH_NS, "Description", e.description);
        appendTextNode(doc, OPENSEARCH_NS, "InputEncoding", e.queryCharset);
        if (e.iconURI) {
            let imageNode = appendTextNode(doc, OPENSEARCH_NS,
                                           "Image",
                                           e.iconURI.spec);
            if (imageNode) {
                imageNode.setAttribute("width", "16");
                imageNode.setAttribute("height", "16");
            }
        }
        appendTextNode(doc, MOZSEARCH_NS, "UpdateInterval", e._updateInterval);
        appendTextNode(doc, MOZSEARCH_NS, "UpdateUrl", e._updateURL);
        appendTextNode(doc, MOZSEARCH_NS, "IconUpdateUrl", e._iconUpdateURL);
        appendTextNode(doc, MOZSEARCH_NS, "SearchForm", e.searchForm);
        if (e._extensionID)
            appendTextNode(doc, MOZSEARCH_NS, "ExtensionID", e._extensionID);

        for (let i = 0; i < e._urls.length; ++i) {
            this._addSerializedEngineUrlToElement(e._urls[i],
                                                  doc,
                                                  doc.documentElement);
            doc.documentElement.appendChild(doc.createTextNode("\n"));
        }

        return doc;
    },


    /*
     * A helper for serializeEngineToDocument.
     *
     * SOURCE:
     *   https://hg.mozilla.org/releases/mozilla-release/file/4e188de86d86/toolkit/components/search/nsSearchService.js#l1293
     */
    _addSerializedEngineUrlToElement(engineUrl, doc, element) {
        let url = doc.createElementNS(OPENSEARCH_NS, "Url");

        url.setAttribute("type", engineUrl.type);
        url.setAttribute("method", engineUrl.method);
        url.setAttribute("template", engineUrl.template);
        if (engineUrl.rels.length)
            url.setAttribute("rel", engineUrl.rels.join(" "));
        if (engineUrl.resultDomain)
            url.setAttribute("resultDomain", engineUrl.resultDomain);

        // Default search engines can include non-standard search parameters
        // used, originally, to have data based in the value of a preference:
        //   https://bugzilla.mozilla.org/show_bug.cgi?id=351817
        // Or simply to include some extra usage info, e.g.:
        //   https://bugzilla.mozilla.org/show_bug.cgi?id=587780
        let hasMozParams = Object.keys(engineUrl.mozparams).length > 0;

        for (let i = 0; i < engineUrl.params.length; ++i) {
            if (engineUrl.params[i].purpose) {
                hasMozParams = true;
                continue;
            }
            let param = doc.createElementNS(OPENSEARCH_NS, "Param");
            param.setAttribute("name", engineUrl.params[i].name);
            param.setAttribute("value", engineUrl.params[i].value);
            url.appendChild(doc.createTextNode("\n  "));
            url.appendChild(param);
        }
        if (hasMozParams) {
            Services.console.logStringMessage(
                "Found some non-standard 'MozParam' parameters in the " +
                "definition of the exported search engine. As these " +
                "parameters are recognized by Firefox only for default " +
                "engines, they were skipped.");
        }
        url.appendChild(doc.createTextNode("\n"));

        element.appendChild(url);
    },


    /*
     * Return a sanitized name from a engine to be used as a filename, or a
     * random name if a sanitized name cannot be obtained (i.e. the given name
     * contains no valid characters).
     *
     * SOURCE:
     *   https://hg.mozilla.org/releases/mozilla-release/file/4e188de86d86/toolkit/components/search/nsSearchService.js#l990
     */
    sanitizeEngineName(name) {
        name = name.toLowerCase()
                   .replace(/\s+/g, "-")    // Replace spaces with a hyphen
                   .replace(/-{2,}/g, "-")  // Reduce consecutive hyphens
                   .normalize("NFKD")       // Decompose chars with diacritics
                   .replace(/[^-a-z0-9]/g, "");     // Final cleaning

        if (name.length < 1)
            name = Math.random().toString(36).replace(/^.*\./, "");

        return name.substring(0, MAX_ENGINE_FILENAME_LENGTH);
    }
};


function appendTextNode(document, namespace, localName, value) {
    if (!value)
        return null;

    let node = document.createElementNS(namespace, localName);
    node.appendChild(document.createTextNode(value));
    document.documentElement.appendChild(node);
    document.documentElement.appendChild(document.createTextNode("\n"));
    return node;
}
