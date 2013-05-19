/*
 * Copyright (c) 2013 Next Tuesday GmbH.
 *               Authored by: Seif Lotfy
 * Copyright (c) 2013 Eslam Mostafa<cseslam@gmail.com>.
 * Copyright (c) 2013 Seif Lotfy<seif@lotfy.com>.
 * Copyright (c) 2013 Vadim Rutkovsky<vrutkovs@redhat.com>.
 *
 * Gnome Music is free software; you can Public License as published by the
 * Free Software Foundation; either version 2 of the License, or (at your
 * option) any later version.
 *
 * Gnome Music is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License
 * for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with Gnome Music; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 *
 */

const Lang = imports.lang;
const Gtk = imports.gi.Gtk;
const Gdk = imports.gi.Gdk;
const GdkPixbuf = imports.gi.GdkPixbuf;
const GObject = imports.gi.GObject;
const Gd = imports.gi.Gd;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Grl = imports.gi.Grl;
const Tracker = imports.gi.Tracker;
const Signals = imports.signals;
const Application = imports.application;
const Query = imports.query;
const Widgets = imports.widgets;
const Toolbar = imports.toolbar;

const tracker = Tracker.SparqlConnection.get (null);
const AlbumArtCache = imports.albumArtCache;
const Grilo = imports.grilo;
const albumArtCache = AlbumArtCache.AlbumArtCache.getDefault();

const nowPlayingIconName = 'media-playback-start-symbolic';
const errorIconName = 'dialog-error-symbolic';
const starIconName = GdkPixbuf.Pixbuf.new_from_file('/usr/share/icons/gnome/scalable/status/starred-symbolic.svg');

function extractFileName(uri) {
    var exp = /^.*[\\\/]|[.][^.]*$/g;
    return unescape(uri.replace(exp, ''));
}

const grilo = Grilo.grilo;


const LoadMoreButton = new Lang.Class({
    Name: 'LoadMoreButton',
    _init: function(counter) {
        this._block = false;
        this._counter = counter;
        let child = new Gtk.Grid({ column_spacing: 10,
                                   hexpand: false,
                                   halign: Gtk.Align.CENTER,
                                   visible: true });

        this._spinner = new Gtk.Spinner({ halign: Gtk.Align.CENTER,
                                          no_show_all: true });
        this._spinner.set_size_request(16, 16);
        child.add(this._spinner);

        this._label = new Gtk.Label({ label: "Load More",
                                      visible: true });
        child.add(this._label);

        this.widget = new Gtk.Button({ no_show_all: true,
                                       child: child });
        this.widget.get_style_context().add_class('documents-load-more');
        this.widget.connect('clicked', Lang.bind(this,
            function() {
                this._label.label = "Loading...";
                this._spinner.show();
                this._spinner.start();
            }));

        this._onItemCountChanged();
    },

    _onItemCountChanged: function() {
        let remainingDocs = this._counter();
        let visible = !(remainingDocs <= 0 || this._block);
        this.widget.set_visible(visible);

        if (!visible) {
            this._label.label = "Load More";
            this._spinner.stop();
            this._spinner.hide();
        }
    },

    setBlock: function(block) {
        if (this._block == block)
            return;

        this._block = block;
        this._onItemCountChanged();
    }
});

const ViewContainer = new Lang.Class({
    Name: "ViewContainer",
    Extends: Gtk.Stack,

    _init: function(title, header_bar, use_stack) {
        this.parent({transition_type: Gtk.StackTransitionType.CROSSFADE});
        this._grid = new Gtk.Grid({orientation: Gtk.Orientation.VERTICAL})
        this._iconWidth = -1
        this._iconHeight = 128
        this._offset = 0;
        this._adjustmentValueId = 0;
        this._adjustmentChangedId = 0;
        this._scrollbarVisibleId = 0;
        this._model = Gtk.ListStore.new([
            GObject.TYPE_STRING,
            GObject.TYPE_STRING,
            GObject.TYPE_STRING,
            GObject.TYPE_STRING,
            GdkPixbuf.Pixbuf,
            GObject.TYPE_OBJECT,
            GObject.TYPE_BOOLEAN,
            GObject.TYPE_STRING,
            GObject.TYPE_BOOLEAN
        ]);
        this.view = new Gd.MainView({
            shadow_type: Gtk.ShadowType.NONE
        });
        this.view.set_view_type(Gd.MainViewType.ICON);
        this.view.set_model(this._model);
        if (use_stack){
            this.stack = new Gd.Stack({
                transition_type: Gd.StackTransitionType.SLIDE_RIGHT,
            })
            var dummy = new Gtk.Frame({visible: false});
            this.stack.add_named(dummy, "dummy");
            this.stack.add_named(this.view, "artists");
            this.stack.set_visible_child_name("dummy");
            this._grid.add(this.stack);
        } else {
            this._grid.add(this.view);
        }

        this._loadMore = new LoadMoreButton(this._getRemainingItemCount);
        this._grid.add(this._loadMore.widget);
        this._loadMore.widget.connect("clicked", Lang.bind(this, this.populate))
        this.view.connect('item-activated',
                            Lang.bind(this, this._onItemActivated));
        this._cursor = null;
        this.header_bar = header_bar;
        this.title = title;

        this.add(this._grid)

        this.show_all();
        this._items = [];
        this._loadMore.widget.hide();
        this._connectView();
        this._symbolicIcon = albumArtCache.makeDefaultIcon(this._iconHeight, this._iconWidth);
        grilo.connect('ready', Lang.bind(this, this.populate));
        this.header_bar.connect('state-changed', Lang.bind(this, this._onStateChanged))
    },

    _onStateChanged: function() {
    },

    _connectView: function() {
        this._adjustmentValueId = this.view.vadjustment.connect(
            'value-changed',
            Lang.bind(this, this._onScrolledWinChange)
        );
        this._adjustmentChangedId = this.view.vadjustment.connect(
            'changed',
            Lang.bind(this, this._onScrolledWinChange)
        );
        this._scrollbarVisibleId = this.view.get_vscrollbar().connect(
            'notify::visible',
            Lang.bind(this, this._onScrolledWinChange)
        );
        this._onScrolledWinChange();
    },

    _onScrolledWinChange: function() {
        let vScrollbar = this.view.get_vscrollbar();
        let adjustment = this.view.vadjustment;
        let revealAreaHeight = 32;

        // if there's no vscrollbar, or if it's not visible, hide the button
        if (!vScrollbar ||
            !vScrollbar.get_visible()) {
            this._loadMore.setBlock(true);
            return;
        }

        let value = adjustment.value;
        let upper = adjustment.upper;
        let page_size = adjustment.page_size;

        let end = false;
        // special case this values which happen at construction
        if ((value == 0) && (upper == 1) && (page_size == 1))
            end = false;
        else
            end = !(value < (upper - page_size - revealAreaHeight));
        if (this._getRemainingItemCount() <= 0)
            end = false;
        this._loadMore.setBlock(!end);
    },

    populate: function() {
    },

    _addItem: function(source, param, item) {
        if (item != null) {
            this._offset += 1;
            var iter = this._model.append();
            var artist = "Unknown"
            if (item.get_author() != null)
                artist = item.get_author();
            if (item.get_string(Grl.METADATA_KEY_ARTIST) != null)
                artist = item.get_string(Grl.METADATA_KEY_ARTIST)
            if ((item.get_title() == null) && (item.get_url() != null)) {
                item.set_title (extractFileName(item.get_url()));
            }
            try{
                if (item.get_url())
                    this.player.discoverer.discover_uri(item.get_url());
                this._model.set(
                        iter,
                        [0, 1, 2, 3, 4, 5, 6, 7],
                        [toString(item.get_id()), "", item.get_title(), artist, this._symbolicIcon, item, false, nowPlayingIconName]
                    );
            } catch(err) {
                log("failed to discover url " + item.get_url());
                this._model.set(
                        iter,
                        [0, 1, 2, 3, 4, 5, 6, 7],
                        [toString(item.get_id()), "", item.get_title(), artist, this._symbolicIcon, item, true, errorIconName]
                    );
            }
            GLib.idle_add(300, Lang.bind(this, this._updateAlbumArt, item, iter));
        }
    },

    _getRemainingItemCount: function () {
        let count = -1;
        if (this.countQuery != null) {
            let cursor = tracker.query(this.countQuery, null)
            if (cursor != null && cursor.next(null))
                count = cursor.get_integer(0);
        }
        return ( count - this._offset);
    },

    _updateAlbumArt: function(item, iter) {
        var artist = null;
        if (item.get_author() != null)
            artist = item.get_author();
        if (item.get_string(Grl.METADATA_KEY_ARTIST) != null)
            artist = item.get_string(Grl.METADATA_KEY_ARTIST)
        var icon = albumArtCache.lookup(this._iconHeight, artist, item.get_string(Grl.METADATA_KEY_ALBUM));
        if (icon != null) {
            icon = albumArtCache.makeIconFrame(icon)
            this._model.set_value(iter, 4, icon);
            return false;
        }
        var options = Grl.OperationOptions.new(null);
        options.set_flags (Grl.ResolutionFlags.FULL | Grl.ResolutionFlags.IDLE_RELAY);
        grilo.tracker.resolve(
            item,
            [Grl.METADATA_KEY_THUMBNAIL],
            options,
            Lang.bind(this,
            function(source, param, item) {
                var uri = item.get_thumbnail();
                albumArtCache.getFromUri(uri,
                    artist,
                    item.get_string(Grl.METADATA_KEY_ALBUM),
                    this._iconWidth,
                    this._iconHeight,
                    Lang.bind(this,
                        function (icon) {
                            icon = albumArtCache.makeIconFrame(icon);
                            this._model.set_value(iter, 4, icon);
                        }))
            }));
        this.emit("album-art-updated");
        return false;
    },

    _addListRenderers: function () {
    },

    _onItemActivated: function (widget, id, path) {
    }
});
Signals.addSignalMethods(ViewContainer.prototype);

//Class for the Empty View
const Empty = new Lang.Class({
    Name: "Empty",
    Extends: Gtk.Stack,

    _init: function(header_bar,player){
        this.parent({transition_type: Gtk.StackTransitionType.CROSSFADE});
        let builder = new Gtk.Builder();
        builder.add_from_resource('/org/gnome/music/NoMusic.ui');
        let widget = builder.get_object('container');
        print(widget);
        this.add(widget);
        this.show_all();
    }
});


const Albums = new Lang.Class({
    Name: "AlbumsView",
    Extends: ViewContainer,

    _init: function(header_bar, player){
        this.parent("Albums", header_bar);
        this.view.set_view_type(Gd.MainViewType.ICON);
        this.countQuery = Query.album_count;
        this._albumWidget = new Widgets.AlbumWidget (player);
        this.add(this._albumWidget)
        this.header_bar.setState (1);
    },

    _onStateChanged: function (widget) {
        if (this.header_bar.get_stack() != null &&
            this == this.header_bar.get_stack().get_visible_child())
            this.visible_child = this._grid;
    },

    _onItemActivated: function (widget, id, path) {
        var iter = this._model.get_iter (path)[1];
        var title = this._model.get_value (iter, 2);
        var artist = this._model.get_value (iter, 3);
        var item = this._model.get_value (iter, 5);
        var window = new Gtk.Window ();
        this._albumWidget.update (artist, title, item);
        this.header_bar.setState (0);
        this.header_bar.title = title;
        this.header_bar.sub_title = artist;
        this.visible_child = this._albumWidget;
    },

    populate: function() {
        if (grilo.tracker != null)
            grilo.populateAlbums (this._offset, Lang.bind(this, this._addItem, null));
    },

});

const Songs = new Lang.Class({
    Name: "SongsView",
    Extends: ViewContainer,

    _init: function(header_bar, player) {
        this.parent("Songs", header_bar);
        this.countQuery = Query.songs_count;
        this._items = {};
        this.isStarred = null;
        this.view.set_view_type(Gd.MainViewType.LIST);
        this.view.get_generic_view().get_style_context().add_class("songs-list")
        this._iconHeight = 32;
        this._iconWidth = 32;
        this._symbolicIcon = albumArtCache.makeDefaultIcon(this._iconHeight, this._iconWidth)
        this._addListRenderers();
        this.player = player;
        this.player.connect('playlist-item-changed', Lang.bind(this, this.updateModel));
    },

    _onItemActivated: function (widget, id, path) {
        var iter = this._model.get_iter(path)[1]
        if (this._model.get_value(iter, 7) != errorIconName) {
            this.player.setPlaylist("Songs", null, this._model, iter, 5);
            this.player.setPlaying(true);
        }
    },

    updateModel: function(player, playlist, currentIter){
        if (playlist != this._model){
            return false;}
        if (this.iterToClean){
            this._model.set_value(this.iterToClean, 6, false);
        }
        this._model.set_value(currentIter, 6, true);
        this.iterToClean = currentIter.copy();
        return false;
    },

    _addItem: function(source, param, item) {
        if (item != null) {
            this._offset += 1;
            var iter = this._model.append();
            if ((item.get_title() == null) && (item.get_url() != null)) {
                item.set_title (extractFileName(item.get_url()));
            }
            let test = true;
            try{
                if (item.get_url())
                    this.player.discoverer.discover_uri(item.get_url());
                this._model.set(
                        iter,
                        [5, 6, 7,8],
                        [item, false, nowPlayingIconName,test]
                    );
            } catch(err) {
                log("failed to discover url " + item.get_url());
                this._model.set(
                        iter,
                        [5, 6, 7,8],
                        [item, true, errorIconName,test]
                    );
            }
        }
    },

    _addListRenderers: function() {
        let listWidget = this.view.get_generic_view();
        let cols = listWidget.get_columns();
        let cells = cols[0].get_cells();
        cells[2].visible = false;
        let nowPlayingSymbolRenderer = new Gtk.CellRendererPixbuf({ xpad: 0,ypad: 10 });
        var columnNowPlaying = new Gtk.TreeViewColumn();
        nowPlayingSymbolRenderer.set_property("xalign", 1.0);
        columnNowPlaying.pack_start(nowPlayingSymbolRenderer, false);
        columnNowPlaying.set_property('fixed-width', 24);
        columnNowPlaying.add_attribute(nowPlayingSymbolRenderer, "visible", 6);
        columnNowPlaying.add_attribute(nowPlayingSymbolRenderer, "icon_name", 7);
        listWidget.insert_column(columnNowPlaying, 0);

        let titleRenderer = new Gtk.CellRendererText({ xpad: 0 });
        listWidget.add_renderer(titleRenderer,Lang.bind(this,function (col,cell,model,iter) {
            let item = model.get_value(iter,5);
            titleRenderer.set_property("xalign",0.0);
            titleRenderer.set_property("yalign", 0.5);
            titleRenderer.text = item.get_title();
        }))
        let starRenderer = new Gtk.CellRendererPixbuf({xpad: 32});
        listWidget.add_renderer(starRenderer,Lang.bind(this,function (col,cell,model,iter) {
            let showstar = model.get_value(iter,8);
            if(showstar){
            starRenderer.pixbuf = starIconName
            }
        }))
        let durationRenderer =
            new Gd.StyledTextRenderer({ xpad: 32 });
        durationRenderer.add_class('dim-label');
        listWidget.add_renderer(durationRenderer, Lang.bind(this,
            function(col, cell, model, iter) {
                let item = model.get_value(iter, 5);
                if (item) {
                    let duration = item.get_duration ();
                    var minutes = parseInt(duration / 60);
                    var seconds = duration % 60;
                    var time = null
                    if (seconds < 10)
                        time =  minutes + ":0" + seconds;
                    else
                        time = minutes + ":" + seconds;
                    durationRenderer.set_property("xalign", 1.0);
                    durationRenderer.text = time;
                }
            }));

        let artistRenderer =
            new Gd.StyledTextRenderer({ xpad: 32});
        artistRenderer.add_class('dim-label');
        artistRenderer.set_property("ellipsize", 3);
        listWidget.add_renderer(artistRenderer, Lang.bind(this,
            function(col, cell, model, iter) {
                let item = model.get_value(iter, 5);
                if (item) {
                    artistRenderer.set_property("ellipsize", 3);
                    artistRenderer.text = item.get_string(Grl.METADATA_KEY_ARTIST);
                }
            }));
        let typeRenderer =
            new Gd.StyledTextRenderer({ xpad: 32});
        typeRenderer.add_class('dim-label');
        typeRenderer.set_property("ellipsize", 3);
        listWidget.add_renderer(typeRenderer, Lang.bind(this,
            function(col, cell, model, iter) {
                let item = model.get_value(iter, 5);
                if (item) {
                    typeRenderer.set_property("ellipsize", 3);
                    typeRenderer.text = item.get_string(Grl.METADATA_KEY_ALBUM);
                }
            }));

    },

    populate: function() {
        if (grilo.tracker != null)
            grilo.populateSongs (this._offset, Lang.bind(this, this._addItem, null));
    },

});

const Playlists = new Lang.Class({
    Name: "PlaylistsView",
    Extends: ViewContainer,

    _init: function(header_bar, player) {
        this.parent("Playlists", header_bar);
    },
});

const Artists = new Lang.Class({
    Name: "ArtistsView",
    Extends: ViewContainer,

    _init: function(header_bar, player) {
        this.parent("Artists", header_bar, true);
        this.player = player;
        this._artists = {};
        this.countQuery = Query.artist_count;
        this._artistAlbumsWidget = new Gtk.Frame({
            shadow_type: Gtk.ShadowType.NONE
        });
        this.view.set_view_type(Gd.MainViewType.LIST);
        this.view.set_hexpand(false);
        this._artistAlbumsWidget.set_hexpand(true);
        this.view.get_style_context().add_class("artist-panel");
        this.view.get_generic_view().get_selection().set_mode(Gtk.SelectionMode.SINGLE);
        this.albumsCountQuery = Query.album_count;
        this.countQuery = Query.album_count;
        this._loadMoreBtn = new LoadMoreButton(this._getRemainingItemCount);
        var scrolledWindow = new Gtk.ScrolledWindow();
        scrolledWindow.set_policy(
            Gtk.PolicyType.NEVER,
            Gtk.PolicyType.AUTOMATIC);
        scrolledWindow.add(this._artistAlbumsWidget);
        this._grid.attach(new Gtk.Separator({orientation: Gtk.Orientation.VERTICAL}), 1, 0, 1, 1)
        this._grid.attach(scrolledWindow, 2, 0, 1, 1);
        this._grid.attach(this._loadMoreBtn.widget, 2, 1, 1, 1);
        this._addListRenderers();
        if(Gtk.Settings.get_default().gtk_application_prefer_dark_theme)
            this.view.get_generic_view().get_style_context().add_class("artist-panel-dark");
        else
            this.view.get_generic_view().get_style_context().add_class("artist-panel-white");
        this._albumsOffset = 0;
        this._allAlbums = [];
        var iter = this._model.append();
        this._artists["All Artists".toLowerCase()] = {"iter": iter, "albums": []};
        this._model.set(
            iter,
            [0, 1, 2, 3],
            ["All Artists", "All Artists", "All Artists", "All Artists"]
        );
        this.emit("artist-added");
        this._loadMoreBtn.widget.connect("clicked", Lang.bind(this, this.populateAllAlbums));
        this.show_all();
        this.view.emit('item-activated', "0", this._model.get_path(iter));
    },

    _addListRenderers: function() {
        let listWidget = this.view.get_generic_view();

        var cols = listWidget.get_columns()
        var cells = cols[0].get_cells()
        cells[2].visible = false

        let typeRenderer =
            new Gd.StyledTextRenderer({ xpad: 0 });
        typeRenderer.set_property("ellipsize", 3);
        typeRenderer.set_property("xalign", 0.0);
        typeRenderer.set_property("yalign", 0.5);
        typeRenderer.set_property("height", 48);
        typeRenderer.set_property("width",220);
        listWidget.add_renderer(typeRenderer, Lang.bind(this,
            function(col, cell, model, iter) {
                typeRenderer.text = model.get_value(iter, 0);
            }));
    },

    _onItemActivated: function (widget, id, path) {
        var children = this._artistAlbumsWidget.get_children();
        for (var i=0; i<children.length; i++)
            this._artistAlbumsWidget.remove(children[i]);
        if(id == "All Artists")
            this._loadMoreBtn.widget.show()
        else
            this._loadMoreBtn.widget.hide()
        var iter = this._model.get_iter (path)[1];
        var artist = this._model.get_value (iter, 0);
        if(id == "All Artists") {
            this.populateAllAlbums();
            var albums = this._allAlbums;
        }
        else
            var albums = this._artists[artist.toLowerCase()]["albums"];
        this.artistAlbums = new Widgets.ArtistAlbums(artist, albums, this.player);
        this._artistAlbumsWidget.add(this.artistAlbums);
        //this._artistAlbumsWidget.update(artist, albums);
    },

    _addItem: function (source, param, item) {
        this._offset += 1;
        if( item == null )
            return
        var artist = "Unknown"
        if (item.get_author() != null)
            artist = item.get_author();
        if (item.get_string(Grl.METADATA_KEY_ARTIST) != null)
            artist = item.get_string(Grl.METADATA_KEY_ARTIST)
        if (this._artists[artist.toLowerCase()] == undefined) {
            var iter = this._model.append();
            this._artists[artist.toLowerCase()] = {"iter": iter, "albums": []}
            this._model.set(
            iter,
            [0, 1, 2, 3],
            [artist, artist, artist, artist]
        );
        }
        this._artists[artist.toLowerCase()]["albums"].push(item)
        this.emit("artist-added");
    },

    _updateAlbums: function () {
        var children = this._artistAlbumsWidget.get_children();
        for (var i=0; i<children.length; i++)
            this._artistAlbumsWidget.remove(children[i]);
        albums = this._allAlbums;
        this.artistAlbums = new Widgets.ArtistAlbums(artist, albums, this.player);
        this._artistAlbumsWidget.add(this.artistAlbums);
        this.show_all();
    },

    populate: function () {
        if(grilo.tracker != null) {
            grilo.populateArtists(this._offset, Lang.bind(this, this._addItem, null));
            //FIXME: We're emitting this too early, need to wait for all artists to be filled in
        }
    },

    populateAllAlbums: function () {
        if (grilo.tracker != null) 
            grilo.populateAlbums (this._albumsOffset, Lang.bind(this, function (source, param, album) {
                this._albumsOffset += 1
                if(album == null)
                    return
                this._allAlbums.push(album);
        }));
    },

});
