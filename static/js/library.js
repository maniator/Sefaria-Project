var sjs = sjs || {};
// Dependancies: util.js, sjs.toc


sjs.library = {
  _texts: {},
  _refmap: {}, // Mapping of simple ref/context keys to the (potentially) versioned key for that ref in _texts. 
  text: function(ref, settings, cb) {
    if (!ref || typeof ref == "object" || typeof ref == "undefined") { debugger; }
    settings = settings || {};
    settings = {
      commentary: settings.commentary || 0,
      context:    settings.context    || 0,
      pad:        settings.pad        || 0,
      version:    settings.version    || null,
      language:   settings.language   || null
    };
    var key = this._textKey(ref, settings);
    if (!cb) {
      return this._getOrBuildTextData(key);
    }          
    if (key in this._texts) {
      var data = this._getOrBuildTextData(key);
      cb(data);
      return data;
    }
    //console.log("API Call for " + key)
    this._api(this._textUrl(ref, settings), function(data) {
      this._saveText(data, settings);
      cb(data);
      //console.log("API return for " + data.ref)
    }.bind(this));
  },
  _textUrl: function(ref, settings) {
    // copy the parts of settings that are used as parameters, but not other
    var params = $.param({
      commentary: settings.commentary,
      context:    settings.context,
      pad:        settings.pad
    });
    var url = "/api/texts/" + normRef(ref);
    if (settings.language && settings.version) {
        url += "/" + settings.language + "/" + settings.version.replace(" ","_");
    }
    return url + "?" + params;
  },
  _textKey: function(ref, settings) {
    // Returns a string used as a key for the cache object of `ref` given `settings`.
    if (!ref) { debugger; }
    var key = ref.toLowerCase();
    if (settings) {
      key = (settings.language && settings.version) ? key + "/" + settings.language + "/" + settings.version : key;
      key = settings.context ? key + "|CONTEXT" : key;
    }
    return key;
  },
  _refKey: function(ref, settings) {
    // Returns the key for this ref without any version/language elements
    if (!ref) { debugger; }
    var key = ref.toLowerCase();
    if (settings) {
      key = settings.context ? key + "|CONTEXT" : key;
    }
    return key;
  },
  _getOrBuildTextData: function(key) {
    var cached = this._texts[key];
    if (!cached || !cached.buildable) { return cached; }
    if (cached.buildable === "Add Context") {
      var segmentData = clone(this.text(cached.ref));
      var contextData = this.text(cached.sectionRef) || this.text(cached.sectionRef, {context: 1});
      segmentData.text = contextData.text;
      segmentData.he   = contextData.he;
      return segmentData;
    }
  },
  _saveText: function(data, settings, skipWrap) {
    if (!data || "error" in data) { 
      //sjs.alert.message(data.error);
      return;
    }
    settings         = settings || {};
    data             = skipWrap ? data : this._wrapRefs(data);
    var key          = this._textKey(data.ref, settings);
    this._texts[key] = data;

    var refkey           = this._refKey(data.ref, settings);
    this._refmap[refkey] = key;

    if (data.ref == data.sectionRef && !data.isSpanning) {
      this._splitTextSection(data, settings);
    } else if (settings.context) {
      // Save a copy of the data at context level
      var newData        = clone(data);
      newData.ref        = data.sectionRef;
      newData.sections   = data.sections.slice(0,-1);
      newData.toSections = data.toSections.slice(0,-1);
      var context_settings = (settings.language && settings.version) ? {
          version: settings.version,
          language: settings.language
      }:{};
      this._saveText(newData, context_settings, true);
    }
    if (data.isSpanning) {
      var spanning_context_settings = (settings.language && settings.version) ? {
          version: settings.version,
          language: settings.language,
          context: 1
      }:{context: 1};
      for (var i = 0; i < data.spanningRefs.length; i++) {
        // For spanning refs, request each section ref to prime cache.
        // console.log("calling spanning prefetch " + data.spanningRefs[i])
        sjs.library.text(data.spanningRefs[i], spanning_context_settings, function(data) {})
      }      
    }

    var index = {
      title:      data.indexTitle,
      heTitle:    data.heIndexTitle, // This is incorrect for complex texts
      categories: data.categories
    };
    this.index(index.title, index);
  },
  _splitTextSection: function(data, settings) {
    // Takes data for a section level text and populates cache with segment levels.
    // Runs recursively for Refs above section level like "Rashi on Genesis 1".
    // Pad the shorter array to make stepping through them easier.
    settings = settings || {};
    var en = typeof data.text == "string" ? [data.text] : data.text;
    var he = typeof data.he == "string" ? [data.he] : data.he;
    var length = Math.max(en.length, he.length);
    var superSectionLevel = data.textDepth == data.sections.length + 1;
    var padContent = superSectionLevel ? [] : "";
    en = en.pad(length, "");
    he = he.pad(length, "");

    var delim = data.ref === data.book ? " " : ":";
    var start = data.textDepth == data.sections.length ? data.sections[data.textDepth-1] : 1;
    for (var i = 0; i < length; i++) {
      var ref          = data.ref + delim + (i+start);
      var sectionRef   = superSectionLevel ? data.sectionRef : ref;
      var segment_data = clone(data);
      $.extend(segment_data, {
        ref: ref,
        heRef: data.heRef + delim + encodeHebrewNumeral(i+start),
        text: en[i],
        he: he[i],
        sections: data.sections.concat(i+1),
        toSections: data.sections.concat(i+1),
        sectionRef: sectionRef,
        nextSegment: i+start == length ? data.next + delim + 1 : data.ref + delim + (i+start+1),
        prevSegment: i+start == 1      ? null : data.ref + delim + (i+start-1),
      });

      var context_settings = (settings.version && settings.language) ? {
          version: settings.version,
          language: settings.language
      } : {};
      this._saveText(segment_data, context_settings, true);

      context_settings.context = 1;
      var contextKey = this._textKey(ref, context_settings);
      this._texts[contextKey] = {buildable: "Add Context", ref: ref, sectionRef: sectionRef};

      var refkey           = this._refKey(ref, context_settings);
      this._refmap[refkey] = contextKey;

    }
  },
  _splitSpanningText: function(data) {
    // Returns an array of section level data, corresponding to spanning `data`.
    // Assumes `data` includes context.
    var sections = [];
    var en = data.text;
    var he = data.he;
    var length = Math.max(en.length, he.length);
    en = en.pad(length, []);
    he = he.pad(length, []);
    var length = Math.max(data.text.length, data.he.length);
    for (var i = 0; i < length; i++) {
      var section        = clone(data);
      section.text       = en[i];
      section.he         = he[i];
    }
  },
  _wrapRefs: function(data) {
    // Wraps citations found in text of data
    if (!data.text) { return data; }
    if (typeof data.text === "string") {
      data.text = sjs.wrapRefLinks(data.text);
    } else {
      data.text = data.text.map(sjs.wrapRefLinks);
    }
    return data;
  },
  _index: {},
  index: function(text, index) {
    // Cache for text index records
    if (!index) {
      return this._index[text];
    } else {
      this._index[text] = index;
    }
  },
  _cacheIndexFromToc: function(toc) {
    // Unpacks contents of sjs.toc and stores it in index cache.
    for (var i = 0; i < toc.length; i++) {
      if ("category" in toc[i]) {
        sjs.library._cacheIndexFromToc(toc[i].contents)
      } else {
        sjs.library.index(toc[i].title, toc[i]);
      }
    }
  },
  _titleVariants: {},
  normalizeTitle: function(title, callback) {
    if (title in this._titleVariants) {  callback(this._titleVariants[title]); }
    this._api("/api/index/" + title, function(data) {
      for (var i = 0; i < data.titleVariants.length; i ++) {
        sjs.library._titleVariants[data.titleVariants[i]] = data.title;
      }
       callback(data.title);
    })
  },
  ref: function(ref) {
    // Returns parsed ref info for string `ref`.
    // Uses this._refmap to find the refkey that has information for this ref.
    // Used in cases when the textual information is not important, so it can
    // be called without worrying about the `settings` parameter for what is available in cache.

    var versioned_key = this._refmap[this._refKey(ref)] || this._refmap[this._refKey(ref, {context:1})];
    if (versioned_key) { return this._getOrBuildTextData(versioned_key);  }
    return null;
  },
  sectionRef: function(ref) {
    // Returns the section level ref for `ref` or null if no data is available
    var oref = this.ref(ref);
    return oref ? oref.sectionRef : null;
  },
  splitSpanningRef: function(ref) {
    // Returns an array of non-spanning refs which correspond to the spanning `ref`
    // e.g. "Genesis 1:1-2" -> ["Genesis 1:1", "Genesis 1:2"]
    var oref = parseRef(ref);
    var isDepth1 = oref.sections.length == 1;
    if (!isDepth1 && oref.sections[oref.sections.length - 2] !== oref.toSections[oref.sections.length - 2]) {
      // TODO handle ranging refs, which requires knowledge of the segment count of each included section
      // i.e., in "Shabbat 2a:5-2b:8" what is the last segment of Shabbat 2a?
      // For now, just return the first non-spanning ref.
      oref.toSections = oref.sections;
      return [humaRef(makeRef(oref))];
    } else {
      var refs  = [];
      var start = oref.sections[oref.sections.length-1];
      var end   = oref.toSections[oref.sections.length-1];
      for (var i = start; i <= end; i++) {
        oref.sections[oref.sections.length-1]   = i;
        oref.toSections[oref.sections.length-1] = i;
        refs.push(humanRef(makeRef(oref)));
      }
      return refs;
    }
  },
  _links: {},
  links: function(ref, cb) {
    // Returns a list of links known for `ref`.
    // WARNING: calling this function with spanning refs can cause bad state in cache.
    // When processing links for "Genesis 2:4-4:4", a link to the entire chapter "Genesis 3" will be split and stored with that key.
    // The data for "Genesis 3" then represents only links to the entire chapter, not all links within the chapter.
    // Fixing this generally on the client side requires more understanding of ref logic. 
    if (!cb) {
      return this._links[ref] || [];
    }
    if (ref in this._links) {
      cb(this._links[ref]);
    } else {
       var url = "/api/links/" + normRef(ref) + "?with_text=0";
       this._api(url, function(data) {
          if ("error" in data) { 
            // sjs.alert.message(data.error);
            return;
          }
          this._saveLinkData(ref, data);
          cb(data);
        }.bind(this));
    }
  },
  _saveLinkData: function(ref, data) {
    this._saveLinksByRef(data);
    this._links[ref] = data;
    this._cacheIndexFromLinks(data);
  },
  _cacheIndexFromLinks: function(links) {
    // Cache partial index information (title, Hebrew title, categories) found in link data.
    for (var i=0; i< links.length; i++) {
      if (this.index(links[i].commentator)) { continue; }
      var index = {
        title:      links[i].commentator,
        heTitle:    links[i].heCommentator,
        categories: [links[i].category],
      };
      this.index(links[i].commentator, index);
    }
  },
  _saveLinksByRef: function(data) {
    this._saveItemsByRef(data, this._links);
  },
  _saveItemsByRef: function(data, store) {
    // For a set of items from the API, save each set split by the specific ref the items points to.
    // E.g, API is called on "Genesis 1", this function also stores the data in buckets like "Genesis 1:1", "Genesis 1:2" etc.
    var splitItems = {}; // Aggregate links by anchorRef
    for (var i=0; i < data.length; i++) {
      var ref = data[i].anchorRef;
      var refs = sjs.library.splitSpanningRef(ref);
      for (var j = 0; j < refs.length; j++) {
        ref = refs[j];
        if (ref in splitItems) {
          splitItems[ref].push(data[i]);
        } else {
          splitItems[ref] = [data[i]];
        }
      }
    }
    for (var ref in splitItems) {
      if (splitItems.hasOwnProperty(ref)) {
        store[ref] = splitItems[ref];
      }
    }
  },
  linksLoaded: function(ref) {
    if (typeof ref == "string") {
      return ref in this._links;
    } else {
      for (var i = 0; i < ref.length; i++) {
        if (!this.linksLoaded(ref[i])) { return false}
      }
      return true;
    }
  },
  linkCount: function(ref, filter) {
    if (!(ref in this._links)) { return 0; }
    var links = this._links[ref];
    links = filter ? this._filterLinks(links, filter) : links;
    return links.length;
  },
  _filterLinks: function(links, filter) {
     return links.filter(function(link){
        return (filter.length == 0 ||
                $.inArray(link.category, filter) !== -1 || 
                $.inArray(link.commentator, filter) !== -1 );
      }); 
  },
  _linkSummaries: {},
  linkSummary: function(ref) {
    // Returns an object summarizing the link counts by category and text
    // Takes either a single string `ref` or an array of string refs.
    if (typeof ref == "string") {
      if (ref in this._linkSummaries) { return this._linkSummaries[ref]; }
      var links = this.links(ref);
    } else {
      var links = [];
      ref.map(function(r) {
        var newlinks = sjs.library.links(r);
        links = links.concat(newlinks);
      });
    }

    var summary = {};
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      // Count Category
      if (link.category in summary) {
        summary[link.category].count += 1
      } else {
        summary[link.category] = {count: 1, books: {}};
      }
      var category = summary[link.category];
      // Count Book
      if (link.commentator in category.books) {
        category.books[link.commentator].count += 1;
      } else {
        category.books[link.commentator] = {count: 1};
      }
    }
    // Add Zero counts for every commentator in this section not alredy in list
    var baseRef    = typeof ref == "string" ? ref : ref[0]; // TODO handle refs spanning sections
    var oRef       = sjs.library.ref(baseRef);
    var sectionRef = oRef ? oRef.sectionRef : baseRef;
    if (ref !== sectionRef) {
      var sectionLinks = sjs.library.links(sectionRef);
      for (var i = 0; i < sectionLinks.length; i++) {
        var l = sectionLinks[i]; 
        if (l.category === "Commentary") {
          if (!("Commentary" in summary)) {
            summary["Commentary"] = {count: 0, books: {}};
          }
          if (!(l.commentator in summary["Commentary"].books)) {
            summary["Commentary"].books[l.commentator] = {count: 0};
          }
        }
      }
    }

    // Convert object into ordered list
    summary = $.map(summary, function(value, category) {
      value.category = category;
      value.books = $.map(value.books, function(value, book) {
        var index      = sjs.library.index(book);
        value.book     = index.title;
        value.heBook   = index.heTitle;
        value.category = index.categories[0];
        return value;
      });
      // Sort the books in the category
      value.books.sort(function(a, b) { 
        // First sort by predefined "top"
        var topByCategory = {
          "Tanach": ["Rashi", "Ibn Ezra", "Ramban", "Sforno"],
          "Talmud": ["Rashi", "Tosafot"]
        }
        var cat = oRef ? oRef["categories"][0] : null;
        var top = topByCategory[cat] || [];
        var aTop = top.indexOf(a.book);
        var bTop = top.indexOf(b.book);
        if (aTop !== -1 || bTop !== -1) {
          aTop = aTop === -1 ? 999 : aTop;
          bTop = bTop === -1 ? 999 : bTop;
          return aTop < bTop ? -1 : 1;
        }
        // Then sort alphabetically
        return a.book > b.book ? 1 : -1; 
      });
      return value;
    });
    // Sort the categories
    summary.sort(function(a, b) {
      // always put Commentary first 
      if      (a.category === "Commentary") { return -1; }
      else if (b.category === "Commentary") { return  1; }
      // always put Modern Works last
      if      (a.category === "Modern Works") { return  1; }
      else if (b.category === "Modern Works") { return -1; }
      return b.count - a.count;
    });
    return summary;
  },
  flatLinkSummary: function(ref) {
    // Returns an array containing texts and categories with counts for ref
    var summary = sjs.library.linkSummary(ref);
    var booksByCat = summary.map(function(cat) { 
      return cat.books.map(function(book) {
        return book;
      });
    });
    var books = [];
    books = books.concat.apply(books, booksByCat);
    return books;     
  },
  _notes: {},
  notes: function(ref, cb) {
    var notes = null;
    if (typeof ref == "string") {
      if (ref in this._notes) { 
        notes = this._notes[ref];
      }
    } else {
      var notes = [];
      ref.map(function(r) {
        var newNotes = sjs.library.notes(r);
        notes = newNotes ? notes.concat(newNotes) : notes;
      });
    }
    if (notes) {
      if (cb) { cb(notes); }
    } else {
      sjs.library.related(ref, function(data) {
        if (cb) { cb(data.notes); }
      });
    }
    return notes;
  },
  _saveNoteData: function(ref, data) {
    this._notes[ref] = data;
    this._saveItemsByRef(data, this._notes);
  },
  _related: {},
  related: function(ref, cb) {
    // Single API to bundle links, sheets, and notes by ref.
    if (!cb) {
      return this._related[ref] || null;
    }
    if (ref in this._related) {
      cb(this._related[ref]);
    } else {
       var url = "/api/related/" + normRef(ref);
       this._api(url, function(data) {
          if ("error" in data) { 
            // sjs.alert.message(data.error);
            return;
          }
          this._saveLinkData(ref, data.links);
          this._saveNoteData(ref, data.notes);
          this.sheets._saveSheetsByRefData(ref, data.sheets);
          this._related[ref] = data;
          cb(data);
        }.bind(this));
    }
  },
  _relatedSummaries: {},
  relatedSummary: function(ref) {
    // Returns a summary object of all categories of related content.
    if (typeof ref == "string") {
      if (ref in this._relatedSummaries) { return this._relatedSummaries[ref]; }
      var sheets = this.sheets.sheetsByRef(ref) || [];
      var notes  = this.notes(ref) || [];
    } else {
      var sheets = [];
      var notes  = [];
      ref.map(function(r) {
        var newSheets = sjs.library.sheets.sheetsByRef(r);
        sheets = newSheets ? sheets.concat(newSheets) : sheets;
        var newNotes = sjs.library.notes(r);
        notes = newNotes ? notes.concat(newNotes) : notes;
      });
    }

    var summary           = this.linkSummary(ref);
    var commmunityContent = [sheets, notes].filter(function(section) { return section.length > 0; } ).map(function(section) {
      if (!section) { debugger; }
      return {
        book: section[0].category,
        heBook: sjs.library.hebrewCategory(section[0].category),
        category: "Community",
        count: section.length
      };
    });
    var community = {
      category: "Community",
      count: sheets.length + notes.length,
      books: commmunityContent
    };
    if (community.count > 0) {
      summary.push(community);
    }
    this._relatedSummaries[ref] = summary;
    return summary;
  },
  textTocHtml: function(title, cb) {
    // Returns an HTML fragment of the table of contents of the text 'title'
    if (!title) { return ""; }
    if (title in this._textTocHtml) {
      return this._textTocHtml[title]
    } else {
      $.ajax({
        url: "/api/toc-html/" + title,
        dataType: "html",
        success: function(html) {
          html = this._makeTextTocHtml(html, title);
          this._textTocHtml[title] = html;
          cb(html);
        }.bind(this)
      });
      return null;
    } 
  },
  _makeTextTocHtml: function(html, title) {
    // Modifies Text TOC HTML received from server
    // Replaces links and adds commentary setion
    html = html.replace(/ href="\//g, ' data-ref="');
    var commentaryList  = this.commentaryList(title);
    if (commentaryList.length) {
      var commentaryHtml = "<div class='altStruct' style='display:none'>" + 
                              commentaryList.map(function(item) {
                                  return "<a class='refLink' data-ref='" + item.firstSection + "'>" + 
                                            "<span class='en'>" + item.commentator + "</span>" +
                                            "<span class='he'>" + item.heCommentator + "</span>" +
                                          "</a>";
                              }).join("") +
                            "</div>";
      var $html = $("<div>" + html + "</div>");
      var commentaryToggleHtml = "<div class='altStructToggle'>" +
                                    "<span class='en'>Commentary</span>" +
                                    "<span class='he'>מפרשים</span>" +
                                  "</div>";      
      if ($html.find("#structToggles").length) {
        $html.find("#structToggles").append("<span class='toggleDivider'>|</span>" + commentaryToggleHtml);  
      } else {
        var togglesHtml = "<div id='structToggles'>" +
                            "<div class='altStructToggle active'>" +
                                "<span class='en'>Text</span>" +
                                "<span class='he'>טקסט</span>" +
                              "</div>" + 
                              "<span class='toggleDivider'>|</span>" + commentaryToggleHtml +
                          "</div>";
        $html = $("<div><div class='altStruct'>" + html + "</div></div>");
        $html.prepend(togglesHtml);   
      }
      $html.append(commentaryHtml);
      html = $html.html();
    }
    return html;
  },
  sectionString: function(ref) {
    // Returns a pair of nice strings (en, he) of the sections indicated in ref. e.g.,
    // "Genesis 4" -> "Chapter 4", "Guide for the Perplexed, Introduction" - > "Introduction"
    var data = this.ref(ref);
    var result = { 
          en: {named: "", numbered: ""}, 
          he: {named: "", numbered: ""}
        };
    if (!data) { return result; }

    // English
    var sections = ref.slice(data.indexTitle.length+1);
    var name = data.sectionNames.length > 1 ? data.sectionNames[0] + " " : "";
    if (data.isComplex) {
      var numberedSections = data.ref.slice(data.book.length+1);
      if (numberedSections) {
        var namedSections    = sections.slice(0, -(numberedSections.length+1));
        var string           = namedSections + ", " + name +  numberedSections;        
      } else {
        var string = sections;
      }
    } else {
      var string = name + sections;
    }
    result.en.named    = string;
    result.en.numbered = sections;

    // Hebrew
    var sections = data.heRef.slice(data.heIndexTitle.length+1);
    var name = ""; // missing he section names // data.sectionNames.length > 1 ? " " + data.sectionNames[0] : "";
    if (data.isComplex) {
      var numberedSections = data.heRef.slice(data.heTitle.length+1);
      if (numberedSections) {
        var namedSections    = sections.slice(0, -(numberedSections.length+1));
        var string           = namedSections + ", " + name + " " + numberedSections;        
      } else {
        string = sections;
      }

    } else {
      var string = name + sections;
    }
    result.he.named    = string;
    result.he.numbered = sections;

    return result;
  },
  _textTocHtml: {},
  commentaryList: function(title) {
    // Returns the list of commentaries for 'title' which are found in sjs.toc
    var index = this.index(title);
    if (!index) { return []; }
    var cats   = [index.categories[0], "Commentary"];
    var branch = this.tocItemsByCategories(cats);
    var commentariesInBranch = function(title, branch) {
      // Recursively walk a branch of TOC, return a list of all commentaries found on `title`.
      var results = [];
      for (var i=0; i < branch.length; i++) {
        if (branch[i].title) {
          var split = branch[i].title.split(" on ");
          if (split.length == 2 && split[1] === title) {
            results.push(branch[i]);
          }
        } else {
          results = results.concat(commentariesInBranch(title, branch[i].contents));
        }
      }
      return results;
    };
    return commentariesInBranch(title, branch);
  },
  tocItemsByCategories: function(cats) {
    // Returns the TOC items that correspond to the list of categories 'cats'
    var list = clone(sjs.toc);
    for (var i = 0; i < cats.length; i++) {
      var found = false;
      for (var k = 0; k < list.length; k++) {
        if (list[k].category == cats[i]) { 
          list = clone(list[k].contents);
          found = true;
          break;
        }
      }
      if (!found) { return []; }
    }
    return list;
  },
  sheets: {
    _trendingTags: null,
    trendingTags: function(cb) {
      var tags = this._trendingTags;
      if (tags) {
        if (cb) { cb(tags); }
      } else {
        var url = "/api/sheets/trending-tags";
         sjs.library._api(url, function(data) {
            this._trendingTags = data;
            if (cb) { cb(data); }
          }.bind(this));
        }
      return tags;
    },
    _tagList: null,
    tagList: function(cb) {
      var tags = this._tagList;
      if (tags) {
        if (cb) { cb(tags); }
      } else {
        var url = "/api/sheets/tag-list";
         sjs.library._api(url, function(data) {
            this._tagList = data;
            if (cb) { cb(data); }
          }.bind(this));
        }
      return tags;
    },
    _sheetsByTag: {},
    sheetsByTag: function(tag, cb) {
      var sheets = this._sheetsByTag[tag];
      if (sheets) {
        if (cb) { cb(sheets); }
      } else {
        var url = "/api/sheets/tag/" + tag;
         $.getJSON(url, function(data) {
            this._sheetsByTag[tag] = data.sheets;
            if (cb) { cb(data.sheets); }
          }.bind(this));
        }
      return sheets;
    },
    _userSheets: {},
    userSheets: function(uid, cb) {
      var sheets = this._userSheets[uid];
      if (sheets) {
        if (cb) { cb(sheets); }
      } else {
        var url = "/api/sheets/user/" + uid;
         sjs.library._api(url, function(data) {
            this._userSheets[uid] = data.sheets;
            if (cb) { cb(data.sheets); }
          }.bind(this));
        }
      return sheets;
    },
    _sheetsByRef: {},
    sheetsByRef: function(ref, cb) {
      var sheets = null;
      if (typeof ref == "string") {
        if (ref in this._sheetsByRef) { 
          sheets = this._sheetsByRef[ref];
        }
      } else {
        var sheets = [];
        ref.map(function(r) {
          var newSheets = sjs.library.sheets.sheetsByRef(r);
          if (newSheets) {
            sheets = sheets.concat(newSheets);
          }
        });
      }
      if (sheets) {
        if (cb) { cb(sheets); }
      } else {
        sjs.library.related(ref, function(data) {
          if (cb) { cb(data.sheets); }
        });
      }
      return sheets;
    },
    _saveSheetsByRefData: function(ref, data) {
      this._sheetsByRef[ref] = data;
      sjs.library._saveItemsByRef(data, this._sheetsByRef);
    }
  },
  hebrewCategory: function(cat) {
    var categories = {
      "Torah":                "תורה",
      "Tanach":               'תנ"ך',
      "Tanakh":               'תנ"ך',
      "Prophets":             "נביאים",
      "Writings":             "כתובים",
      "Commentary":           "מפרשים",
      "Quoting Commentary":   "פרשנות מצטטת",
      "Targum":               "תרגומים",
      "Mishnah":              "משנה",
      "Tosefta":              "תוספתא",
      "Talmud":               "תלמוד",
      "Bavli":                "בבלי",
      "Yerushalmi":           "ירושלמי",
      "Rif":                  'רי"ף',
      "Kabbalah":             "קבלה",
      "Halakha":              "הלכה",
      "Halakhah":             "הלכה",
      "Midrash":              "מדרש",
      "Aggadic Midrash":      "מדרש אגדה",
      "Halachic Midrash":     "מדרש הלכה",
      "Midrash Rabbah":       "מדרש רבה",
      "Responsa":             'שו"ת',
      "Rashba":               'רשב"א',
      "Rambam":               'רמב"ם',
      "Other":                "אחר",
      "Siddur":               "סידור",
      "Liturgy":              "תפילה",
      "Piyutim":              "פיוטים",
      "Musar":                "ספרי מוסר",
      "Chasidut":             "חסידות",
      "Parshanut":            "פרשנות",
      "Philosophy":           "מחשבת ישראל",
      "Apocrypha":            "ספרים חיצונים",
      "Modern Works":         "עבודות מודרניות",
      "Seder Zeraim":         "סדר זרעים",
      "Seder Moed":           "סדר מועד",
      "Seder Nashim":         "סדר נשים",
      "Seder Nezikin":        "סדר נזיקין",
      "Seder Kodashim":       "סדר קדשים",
      "Seder Toharot":        "סדר טהרות",
      "Seder Tahorot":        "סדר טהרות",
      "Dictionary":           "מילון",
      "Early Jewish Thought": "מחשבת ישראל קדומה",
      "Minor Tractates":      "מסכתות קטנות",
      "Rosh":                 'ר"אש',
      "Maharsha":             'מהרשא',
      "Mishneh Torah":        "משנה תורה",
      "Shulchan Arukh":       "שולחן ערוך",
      "Sheets":               "א sheets",
      "Notes":                "א notes"
    };
    return cat in categories ? categories[cat] : cat;
  },
  search: {
      baseUrl: sjs.searchBaseUrl + "/" + sjs.searchIndex + "/_search",
      execute_query: function (args) {
          // To replace sjs.search.post in search.js

          /* args can contain
           query: query string
           size: size of result set
           from: from what result to start
           get_filters: if to fetch initial filters
           applied_filters: filter query by these filters
           success: callback on success
           error: callback on error
           */
          if (!args.query) {
              return;
          }

          var url = sjs.library.search.baseUrl;
          url += "?size=" + args.size;
          if (args.from) {
              url += "&from=" + args.from;
          }

          return $.ajax({
              url: url,
              type: 'POST',
              data: JSON.stringify(sjs.library.search.get_query_object(args.query, args.get_filters, args.applied_filters)),
              crossDomain: true,
              processData: false,
              dataType: 'json',
              success: args.success,
              error: args.error
          });
      },
      get_query_object: function (query, get_filters, applied_filters) {
          // query: string
          // get_filters: boolean
          // applied_filters: null or list of applied filters (in format supplied by Filter_Tree...)
          var core_query = {
              "query_string": {
                  "query": query.replace(/(\S)"(\S)/g, '$1\u05f4$2'), //Replace internal quotes with gershaim.
                  "default_operator": "AND",
                  "fields": ["content"]
              }
          };

          var o = {
              "sort": [{
                  "order": {}                 // the sort field name is "order"
              }],
              "highlight": {
                  "pre_tags": ["<b>"],
                  "post_tags": ["</b>"],
                  "fields": {
                      "content": {"fragment_size": 200}
                  }
              }
          };

          if (get_filters) {
              //Initial, unfiltered query.  Get potential filters.
              o['query'] = core_query;
              o['aggs'] = {
                  "category": {
                      "terms": {
                          "field": "path",
                          "size": 0
                      }
                  }
              };
          } else if (!applied_filters) {
              o['query'] = core_query;
          } else {
              //Filtered query.  Add clauses.  Don't re-request potential filters.
              var clauses = [];
              for (var i = 0; i < applied_filters.length; i++) {
                  clauses.push({
                      "regexp": {
                          "path": RegExp.escape(applied_filters[i]) + ".*"
                      }
                  })
              }
              o['query'] = {
                  "filtered": {
                      "query": core_query,
                      "filter": {
                          "or": clauses
                      }
                  }
              };
          }
          return o;
      }
  },
  _apiCallbacks: {},
  _api: function(url, callback) {
    // Manage API calls and callbacks to prevent duplicate calls
    if (url in this._apiCallbacks) {
      this._apiCallbacks[url].push(callback);
    } else {
      this._apiCallbacks[url] = [callback];
      $.getJSON(url, function(data) {
        var callbacks = this._apiCallbacks[url];
        for (var i = 0; i < callbacks.length; i++) {
          callbacks[i](data);
        }
        delete this._apiCallbacks[url];
      }.bind(this));
    }
  }
};

// Unpack sjs.toc into index cache
sjs.library._cacheIndexFromToc(sjs.toc);


sjs.palette = {
  darkteal:  "#004e5f",
  raspberry: "#7c406f",
  green:     "#5d956f",
  paleblue:  "#9ab8cb",
  blue:      "#4871bf",
  orange:    "#cb6158",
  lightpink: "#c7a7b4",
  darkblue:  "#073570",
  darkpink:  "#ab4e66",
  lavender:  "#7f85a9",
  yellow:    "#ccb479",
  purple:    "#594176",
  lightblue: "#5a99b7",
  lightgreen:"#97b386",
  red:       "#802f3e",
  teal:      "#00827f"  
};

sjs.categoryColors = {
  "Commentary":         sjs.palette.blue,
  "Tanach" :            sjs.palette.darkteal,
  "Midrash":            sjs.palette.green,
  "Mishnah":            sjs.palette.lightblue,
  "Talmud":             sjs.palette.yellow,
  "Halakhah":           sjs.palette.red,
  "Kabbalah":           sjs.palette.purple,
  "Philosophy":         sjs.palette.lavender,
  "Liturgy":            sjs.palette.darkpink,
  "Tosefta":            sjs.palette.teal,
  "Parshanut":          sjs.palette.paleblue,
  "Chasidut":           sjs.palette.lightgreen,
  "Musar":              sjs.palette.raspberry,
  "Responsa":           sjs.palette.orange,
  "Apocrypha":          sjs.palette.lightpink,
  "Other":              sjs.palette.darkblue,
  "Quoting Commentary": sjs.palette.orange,
  "Commentary2":        sjs.palette.blue,
  "Sheets":             sjs.palette.raspberry,
  "Community":          sjs.palette.raspberry,
  "Targum":             sjs.palette.lavender,
  "Modern Works":       sjs.palette.raspberry
};

sjs.categoryColor = function(cat) {
  if (cat in sjs.categoryColors) {
    return sjs.categoryColors[cat];
  }
  return "transparent";
}