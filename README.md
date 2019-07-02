XML Search Engines Exporter/Importer (XSEEI)
--------------------------------------------

A lightweight, XUL-based (a.k.a. "legacy") add-on for the Mozilla Firefox web browser to import and export your installed search engines (sometimes called "search plugins") from and to XML files in the OpenSearch format.
These features are accessible from the Search pane of the Preferences page in Firefox. No toolbar button or global keyboard shortcut is provided.

    This add-on is NOT available anymore for new Firefox releases; see below.


### Install

#### Firefox 45 to 56
While the public releases aren't available anymore via addons.mozilla.org (AMO), the latest public build can be downloaded from the [releases page](https://github.com/nohamelin/xseei/releases).


#### Firefox 57 and later
Being a XUL-based add-on, it can't be installed in Firefox 57 (a.k.a Firefox Quantum) and later versions, where only add-ons built using the WebExtensions model are accepted. Sadly, it's [not possible to port this add-on to WebExtensions](https://github.com/nohamelin/xseei/issues/1).

As an alternative, I rewrote the main functions of the add-on as single-file scripts that can be run manually via the Scratchpad Firefox tool.
These scripts work locally and they don't depend on any online service (no data is send to any remote network):

* [xseei.import.js](https://gist.github.com/nohamelin/8e2e1b50dc7d97044992ae981487c6ec): to import search engines.
* [xseei.export-all.js](https://gist.github.com/nohamelin/6af8907ca2dd90a9c870629c396c9521): to export all your search engines to a single ZIP file.

Check the initial comments inside each file for further information.


##### What about Pale Moon, Waterfox or other Firefox forks still supporting XUL-based add-dons?

I haven't tested the add-on with these applications, and I haven't planned to support them.


### Original Motivation

Firefox 45 changed how the search engines installed by the user are stored in disk: instead of plain XML files, a unique compressed and hashed file is used. It was in order to provide a better protection against search hijacking, but it made impossible to edit or even inspect the data of these engines to knowledgeable users without the use of additional *ad hoc* tools; even adding a new search engine from the local file system became an awkward task.


### Resources

* [Creating OpenSearch plugins for Firefox | Mozilla Developer Network](https://developer.mozilla.org/en-US/Add-ons/Creating_OpenSearch_plugins_for_Firefox)
* [The specification of the OpenSearch description format](http://www.opensearch.org/Specifications/OpenSearch/1.1#OpenSearch_description_document)
* [*What about search hijacking?*](http://blog.queze.net/post/2015/11/02/What-about-search-hijacking) it presents the main upstream motivations to get rid of the XML-based storage system for search engines from Firefox.


### Known Limitations

* It's not possible to import a search engine with the same name as one of the search engines included by default in Firefox (e.g. "Google"), even if the latter was apparently removed; it's an intentional restriction of the application.


### Contact

Questions and bug reports are still tracked in the [issues](https://github.com/nohamelin/xseei/issues) page. You will need to have a GitHub account to post here. Alternatively, there is a [thread in the MozillaZine forums](http://forums.mozillazine.org/viewtopic.php?f=48&t=3020165) open to general discussion.


### Acknowledgments

* Translations were managed via the [Crowdin](https://crowdin.com/project/xseei) platform. These were kindly provided by volunteers.
