# Copyright (c) 2013 Eslam Mostafa <cseslam@gmail.com>
# Copyright (c) 2013 Vadim Rutkovsky <vrutkovs@redhat.com>
# Copyright (c) 2013 Sai Suman Prayaga <suman.sai14@gmail.com>
# Copyright (c) 2013 Arnel A. Borja <kyoushuu@yahoo.com>
# Copyright (c) 2013 Shivani Poddar <shivani.poddar92@gmail.com>
# Copyright (c) 2013 Manish Sinha <manishsinha@ubuntu.com>
# Copyright (c) 2013 Seif Lotfy <seif@gmail.com>
# Copyright (c) 2013 Guillaume Quintard <guillaume.quintard@gmail.com>
#
# GNOME Music is free software; you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation; either version 2 of the License, or
# (at your option) any later version.
#
# GNOME Music is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License along
# with GNOME Music; if not, write to the Free Software Foundation, Inc.,
# 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.
#
# The GNOME Music authors hereby grant permission for non-GPL compatible
# GStreamer plugins to be used and distributed together with GStreamer
# and GNOME Music.  This permission is above and beyond the permissions
# granted by the GPL license by which GNOME Music is covered.  If you
# modify this code, you may extend this exception to your version of the
# code, but you are not obligated to do so.  If you do not wish to do so,
# delete this exception statement from your version.


from gi.repository import Gtk, Gdk, Gio, GLib, Tracker
from gettext import gettext as _, ngettext

from gnomemusic.toolbar import Toolbar, ToolbarState
from gnomemusic.player import Player, SelectionToolbar
from gnomemusic.query import Query
import gnomemusic.view as Views
import gnomemusic.widgets as Widgets
from gnomemusic.playlists import Playlists

playlist = Playlists.get_default()
tracker = Tracker.SparqlConnection.get(None)

if Gtk.get_minor_version() > 8:
    from gi.repository.Gtk import Stack, StackTransitionType
else:
    from gi.repository.Gd import Stack, StackTransitionType


class Window(Gtk.ApplicationWindow):

    def __init__(self, app):
        Gtk.ApplicationWindow.__init__(self,
                                       application=app,
                                       title=_("Music"))
        self.connect('focus-in-event', self._windows_focus_cb)
        self.settings = Gio.Settings.new('org.gnome.Music')
        self.add_action(self.settings.create_action('repeat'))
        selectAll = Gio.SimpleAction.new('selectAll', None)
        selectAll.connect('activate', self._on_select_all)
        self.add_action(selectAll)
        selectNone = Gio.SimpleAction.new('selectNone', None)
        selectNone.connect('activate', self._on_select_none)
        self.add_action(selectNone)
        self.set_size_request(200, 100)

        size_setting = self.settings.get_value('window-size')
        if isinstance(size_setting[0], int) and isinstance(size_setting[1], int):
            self.resize(size_setting[0], size_setting[1])

        position_setting = self.settings.get_value('window-position')
        if len(position_setting) == 2 \
           and isinstance(position_setting[0], int) \
           and isinstance(position_setting[1], int):
            self.move(position_setting[0], position_setting[1])

        if self.settings.get_value('window-maximized'):
            self.maximize()

        self.connect("window-state-event", self._on_window_state_event)
        self.connect("configure-event", self._on_configure_event)
        self._setup_view()
        self.proxy = Gio.DBusProxy.new_sync(Gio.bus_get_sync(Gio.BusType.SESSION, None),
                                            Gio.DBusProxyFlags.NONE,
                                            None,
                                            'org.gnome.SettingsDaemon',
                                            '/org/gnome/SettingsDaemon/MediaKeys',
                                            'org.gnome.SettingsDaemon.MediaKeys',
                                            None)
        self._grab_media_player_keys()
        try:
            self.proxy.connect('g-signal', self._handle_media_keys)
        except GLib.GError:
            # We cannot grab media keys if no settings daemon is running
            pass

    def _on_configure_event(self, widget, event):
        size = widget.get_size()
        self.settings.set_value('window-size', GLib.Variant('ai', [size[0], size[1]]))

        position = widget.get_position()
        self.settings.set_value('window-position', GLib.Variant('ai', [position[0], position[1]]))

    def _on_window_state_event(self, widget, event):
        self.settings.set_boolean('window-maximized', 'GDK_WINDOW_STATE_MAXIMIZED' in event.new_window_state.value_names)

    def _grab_media_player_keys(self):
        try:
            self.proxy.call_sync('GrabMediaPlayerKeys',
                                 GLib.Variant('(su)', ('Music', 0)),
                                 Gio.DBusCallFlags.NONE,
                                 -1,
                                 None)
        except GLib.GError:
            # We cannot grab media keys if no settings daemon is running
            pass

    def _windows_focus_cb(self, window, event):
        self._grab_media_player_keys()

    def _handle_media_keys(self, proxy, sender, signal, parameters):
        if signal != 'MediaPlayerKeyPressed':
            print('Received an unexpected signal \'%s\' from media player'.format(signal))
            return
        response = parameters.get_child_value(1).get_string()
        if 'Play' in response:
            self.player.play_pause()
        elif 'Stop' in response:
            self.player.Stop()
        elif 'Next' in response:
            self.player.play_next()
        elif 'Previous' in response:
            self.player.play_previous()

    def _setup_view(self):
        self._box = Gtk.VBox()
        self.player = Player()
        self.selection_toolbar = SelectionToolbar()
        self.toolbar = Toolbar()
        self.views = []
        self._stack = Stack(
            transition_type=StackTransitionType.CROSSFADE,
            transition_duration=100,
            visible=True)
        if Gtk.get_minor_version() > 8:
            self.set_titlebar(self.toolbar.header_bar)
        else:
            self._box.pack_start(self.toolbar.header_bar, False, False, 0)
            self.set_hide_titlebar_when_maximized(True)
        self._box.pack_start(self.toolbar.searchbar, False, False, 0)
        self._box.pack_start(self._stack, True, True, 0)
        self._box.pack_start(self.player.eventBox, False, False, 0)
        self._box.pack_start(self.selection_toolbar.eventbox, False, False, 0)
        self.add(self._box)
        count = 1
        cursor = tracker.query(Query.SONGS_COUNT, None)
        if cursor is not None and cursor.next(None):
            count = cursor.get_integer(0)
        if count > 0:
            self.views.append(Views.Albums(self.toolbar, self.selection_toolbar, self.player))
            self.views.append(Views.Artists(self.toolbar, self.selection_toolbar, self.player))
            self.views.append(Views.Songs(self.toolbar, self.selection_toolbar, self.player))
            self.views.append(Views.Playlist(self.toolbar, self.selection_toolbar, self.player))

            for i in self.views:
                self._stack.add_titled(i, i.title, i.title)

            self.toolbar.set_stack(self._stack)
            self.toolbar.searchbar.show()

            self._on_notify_model_id = self._stack.connect('notify::visible-child', self._on_notify_mode)
            self.connect('destroy', self._notify_mode_disconnect)
            self.connect('key_press_event', self._on_key_press)

            self.views[0].populate()
        #To revert to the No Music View when no songs are found
        else:
            self.views.append(Views.Empty(self.toolbar, self.player))
            self._stack.add_titled(self.views[0], _("Empty"), _("Empty"))
            self.toolbar._search_button.set_sensitive(False)
            self.toolbar._select_button.set_sensitive(False)

        self.toolbar._search_button.connect('toggled', self._on_search_toggled)
        self.toolbar.connect('selection-mode-changed', self._on_selection_mode_changed)
        self.selection_toolbar._add_to_playlist_button.connect(
            'clicked', self._on_add_to_playlist_button_clicked)
        self.selection_toolbar._remove_from_playlist_button.connect(
            'clicked', self._on_remove_from_playlist_button_clicked)

        self.toolbar.set_state(ToolbarState.ALBUMS)
        self.toolbar.header_bar.show()
        self.player.eventBox.show_all()
        self._box.show()
        self.show()

    def _on_select_all(self, action, param):
        if self.toolbar._state != ToolbarState.SINGLE:
            model = self._stack.get_visible_child()._model
        else:
            model = self._stack.get_visible_child()._albumWidget.model
        _iter = model.get_iter_first()
        count = 0
        while _iter is not None:
            model.set(_iter, [6], [True])
            _iter = model.iter_next(_iter)
            count = count + 1
        if count > 0:
            self.toolbar._selection_menu_label.set_text(
                ngettext(_("Selected %d item"), _("Selected %d items"), count) % count)
            self.selection_toolbar._add_to_playlist_button.set_sensitive(True)
            self.selection_toolbar._remove_from_playlist_button.set_sensitive(True)
        elif count == 0:
            self.toolbar._selection_menu_label.set_text(_("Click on items to select them"))

    def _on_select_none(self, action, param):
        if self.toolbar._state != ToolbarState.SINGLE:
            model = self._stack.get_visible_child()._model
        else:
            model = self._stack.get_visible_child()._albumWidget.model
        _iter = model.get_iter_first()
        self.selection_toolbar._add_to_playlist_button.set_sensitive(False)
        self.selection_toolbar._remove_from_playlist_button.set_sensitive(False)
        while _iter is not None:
            model.set(_iter, [6], [False])
            _iter = model.iter_next(_iter)
        self.toolbar._selection_menu_label.set_text(_("Click on items to select them"))

    def _on_key_press(self, widget, event):
        modifiers = Gtk.accelerator_get_default_mod_mask()

        if (event.keyval == Gdk.KEY_f and
                (event.state & modifiers) == Gdk.ModifierType.CONTROL_MASK):
            self.toolbar.searchbar.toggle_bar()
        elif (event.keyval == Gdk.KEY_Escape and (event.state & modifiers) == 0):
            self.toolbar.searchbar.show_bar(False)
            if self.toolbar._selectionMode:
                self.toolbar.set_selection_mode(False)
        elif (event.state & modifiers) == 0 and \
                event.keyval in range(33, 126) and \
                not self.toolbar.searchbar.get_reveal_child():
            self.toolbar.searchbar.show_bar(True)

    def _notify_mode_disconnect(self, data=None):
        self._stack.disconnect(self._on_notify_model_id)

    def _on_notify_mode(self, stack, param):
        #Slide out artist list on switching to artists view
        if stack.get_visible_child() == self.views[1] or \
           stack.get_visible_child() == self.views[3]:
            stack.get_visible_child().stack.set_visible_child_name('dummy')
            stack.get_visible_child().stack.set_visible_child_name('sidebar')
        self.toolbar.searchbar.show_bar(False)

    def _toggle_view(self, btn, i):
        self._stack.set_visible_child(self.views[i])

    def _on_search_toggled(self, button, data=None):
        self.toolbar.searchbar.show_bar(button.get_active())

    def _on_selection_mode_changed(self, widget, data=None):
        if self.toolbar._selectionMode:
            in_playlist = self._stack.get_visible_child() == self.views[3]
            self.selection_toolbar._add_to_playlist_button.set_visible(not in_playlist)
            self.selection_toolbar._remove_from_playlist_button.set_visible(in_playlist)

    def _on_add_to_playlist_button_clicked(self, widget):
        if self._stack.get_visible_child() == self.views[3]:
            return

        def callback(selected_uris):
            if len(selected_uris) < 1:
                return

            add_to_playlist = Widgets.PlaylistDialog(self)
            if add_to_playlist.dialog_box.run() == Gtk.ResponseType.ACCEPT:
                playlist.add_to_playlist(
                    add_to_playlist.get_selected(),
                    selected_uris)
            self.toolbar.set_selection_mode(False)
            add_to_playlist.dialog_box.destroy()

        self._stack.get_visible_child().get_selected_track_uris(callback)

    def _on_remove_from_playlist_button_clicked(self, widget):
        if self._stack.get_visible_child() != self.views[3]:
            return

        def callback(selected_uris):
            if len(selected_uris) < 1:
                return

            playlist.remove_from_playlist(
                self.views[3].current_playlist,
                selected_uris)
            self.toolbar.set_selection_mode(False)

        self._stack.get_visible_child().get_selected_track_uris(callback)
