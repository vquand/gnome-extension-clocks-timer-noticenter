import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageList from 'resource:///org/gnome/shell/ui/messageList.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {
    createTimerSettings,
    createTimerState,
    displayTimerState,
    formatTimerProgress,
    normalizeTimerMinutes,
    normalizeTimerPresets,
    POMODORO_PRESETS,
    pauseTimerState,
    resumeTimerState,
    shouldShowTopBarTimer,
    TIMER_MODES,
    timerProfileFromSettings,
    timerMessageSummary,
    timerRemainingSeconds,
    timerSecondsFromMinutes,
} from './core.js';

const TICK_INTERVAL_MS = 500;
const LOG_PREFIX = '[Notification Center Timer]';

function entryText(entry) {
    return entry?.clutter_text?.get_text?.() ?? '';
}

function setEntryText(entry, value) {
    entry?.clutter_text?.set_text(`${value ?? ''}`);
}

function createSettingsEntry(value, hintText) {
    const entry = new St.Entry({
        can_focus: true,
        hint_text: hintText,
        style_class: 'clocks-timer-settings-entry',
        x_expand: true,
    });
    setEntryText(entry, value);
    return entry;
}

const TimerSettingsDialog = GObject.registerClass(
class TimerSettingsDialog extends ModalDialog.ModalDialog {
    constructor(settings, onSave, onClose) {
        super({styleClass: 'clocks-timer-settings-dialog'});

        const normalizedSettings = createTimerSettings(settings);
        this._mode = normalizedSettings.mode;
        this._normalMinutes = normalizedSettings.normalMinutes.slice();
        this._pomodoro = {...normalizedSettings.pomodoro};
        this._customPomodoro = normalizedSettings.pomodoro.presetId === 'custom'
            ? {...normalizedSettings.pomodoro}
            : {
                presetId: 'custom',
                name: 'Custom',
                focusMinutes: normalizedSettings.pomodoro.focusMinutes,
                breakMinutes: normalizedSettings.pomodoro.breakMinutes,
            };
        this._onSave = onSave;
        this._onClose = onClose;

        this._buildContent();
    }

    _buildContent() {
        this.contentLayout.add_child(new St.Label({
            text: 'Timer settings',
            style_class: 'clocks-timer-settings-title',
        }));
        this.contentLayout.add_child(new St.Label({
            text: 'Choose a timer mode and configure its quick-start values.',
            style_class: 'clocks-timer-settings-description',
            x_expand: true,
        }));

        this._modeRow = new St.BoxLayout({
            style_class: 'clocks-timer-settings-mode-row',
            x_expand: true,
        });
        this._normalModeButton = this._createModeButton('Normal timer', TIMER_MODES.NORMAL);
        this._pomodoroModeButton = this._createModeButton('Pomodoro timer', TIMER_MODES.POMODORO);
        this._modeRow.add_child(this._normalModeButton);
        this._modeRow.add_child(this._pomodoroModeButton);
        this.contentLayout.add_child(this._modeRow);

        this._normalPanel = this._buildNormalPanel();
        this._pomodoroPanel = this._buildPomodoroPanel();
        this.contentLayout.add_child(this._normalPanel);
        this.contentLayout.add_child(this._pomodoroPanel);

        this.setButtons([
            {
                action: () => this._cancel(),
                key: Clutter.KEY_Escape,
                label: 'Cancel',
            },
            {
                action: () => this._save(),
                default: true,
                key: Clutter.KEY_Return,
                label: 'Save',
            },
        ]);

        this._renderMode();
    }

    _createModeButton(label, mode) {
        const button = new St.Button({
            label,
            style_class: 'clocks-timer-settings-mode-button',
            x_expand: true,
        });
        button.connectObject('clicked', () => {
            this._mode = mode;
            this._renderMode();
        }, this);
        return button;
    }

    _buildNormalPanel() {
        const panel = new St.BoxLayout({
            vertical: true,
            style_class: 'clocks-timer-settings-panel',
            x_expand: true,
        });
        panel.add_child(new St.Label({
            text: 'Quick durations (minutes)',
            style_class: 'clocks-timer-settings-section-title',
        }));
        panel.add_child(new St.Label({
            text: 'Leave fields blank to use fewer than three buttons.',
            style_class: 'clocks-timer-settings-description',
        }));

        const entriesRow = new St.BoxLayout({
            style_class: 'clocks-timer-settings-entry-row',
            x_expand: true,
        });
        this._normalEntries = [0, 1, 2].map(index => {
            const entry = createSettingsEntry(this._normalMinutes[index] ?? '', `${index + 1}`);
            entriesRow.add_child(entry);
            return entry;
        });
        panel.add_child(entriesRow);

        return panel;
    }

    _buildPomodoroPanel() {
        const panel = new St.BoxLayout({
            vertical: true,
            style_class: 'clocks-timer-settings-panel',
            x_expand: true,
        });
        panel.add_child(new St.Label({
            text: 'Pomodoro preset',
            style_class: 'clocks-timer-settings-section-title',
        }));

        this._presetButton = new St.Button({
            label: this._pomodoro.name,
            style_class: 'clocks-timer-settings-preset-button',
            x_expand: true,
        });
        this._presetButton.connectObject('clicked', () => {
            this._presetList.visible = !this._presetList.visible;
        }, this);
        panel.add_child(this._presetButton);

        this._presetList = new St.BoxLayout({
            vertical: true,
            style_class: 'clocks-timer-settings-preset-list',
            x_expand: true,
        });
        this._presetList.visible = false;
        for (const preset of POMODORO_PRESETS) {
            const customValues = preset.id === 'custom' ? this._customPomodoro : preset;
            const button = new St.Button({
                label: `${customValues.name} · ${customValues.focusMinutes}/${customValues.breakMinutes} min`,
                style_class: 'clocks-timer-settings-preset-option',
                x_expand: true,
            });
            button.connectObject(
                'clicked', () => this._selectPomodoroPreset(preset.id), this);
            this._presetList.add_child(button);
        }
        panel.add_child(this._presetList);

        this._presetSummary = new St.Label({
            style_class: 'clocks-timer-settings-summary',
            x_expand: true,
        });
        panel.add_child(this._presetSummary);

        this._customPanel = new St.BoxLayout({
            vertical: true,
            style_class: 'clocks-timer-settings-custom-panel',
            x_expand: true,
        });
        this._customPanel.add_child(new St.Label({
            text: 'Custom name',
            style_class: 'clocks-timer-settings-field-label',
        }));
        this._customNameEntry = createSettingsEntry(this._pomodoro.name, 'Name');
        this._customPanel.add_child(this._customNameEntry);

        const timesRow = new St.BoxLayout({
            style_class: 'clocks-timer-settings-time-row',
            x_expand: true,
        });
        const focusColumn = new St.BoxLayout({vertical: true, x_expand: true});
        focusColumn.add_child(new St.Label({
            text: 'Focus (min)',
            style_class: 'clocks-timer-settings-field-label',
        }));
        this._customFocusEntry = createSettingsEntry(this._pomodoro.focusMinutes, '25');
        focusColumn.add_child(this._customFocusEntry);
        timesRow.add_child(focusColumn);

        const breakColumn = new St.BoxLayout({vertical: true, x_expand: true});
        breakColumn.add_child(new St.Label({
            text: 'Break (min)',
            style_class: 'clocks-timer-settings-field-label',
        }));
        this._customBreakEntry = createSettingsEntry(this._pomodoro.breakMinutes, '5');
        breakColumn.add_child(this._customBreakEntry);
        timesRow.add_child(breakColumn);
        this._customPanel.add_child(timesRow);
        panel.add_child(this._customPanel);

        this._renderPomodoro();
        return panel;
    }

    _selectPomodoroPreset(presetId) {
        this._captureCustomPomodoro();

        if (presetId === 'custom') {
            this._pomodoro = {...this._customPomodoro};
        } else {
            const preset = POMODORO_PRESETS.find(item => item.id === presetId);
            this._pomodoro = {...preset};
        }

        this._presetList.visible = false;
        this._renderPomodoro();
    }

    _captureCustomPomodoro() {
        if (this._pomodoro.presetId !== 'custom')
            return;

        this._customPomodoro = {
            presetId: 'custom',
            name: entryText(this._customNameEntry),
            focusMinutes: entryText(this._customFocusEntry),
            breakMinutes: entryText(this._customBreakEntry),
        };
    }

    _renderPomodoro() {
        const isCustom = this._pomodoro.presetId === 'custom';
        this._presetButton.label = this._pomodoro.name;
        this._presetSummary.text = `Focus: ${this._pomodoro.focusMinutes} min · ` +
            `Break: ${this._pomodoro.breakMinutes} min`;
        this._presetSummary.visible = !isCustom;
        this._customPanel.visible = isCustom;

        if (isCustom) {
            setEntryText(this._customNameEntry, this._pomodoro.name);
            setEntryText(this._customFocusEntry, this._pomodoro.focusMinutes);
            setEntryText(this._customBreakEntry, this._pomodoro.breakMinutes);
        }
    }

    _renderMode() {
        const isPomodoro = this._mode === TIMER_MODES.POMODORO;
        this._normalPanel.visible = !isPomodoro;
        this._pomodoroPanel.visible = isPomodoro;

        for (const [button, selected] of [
            [this._normalModeButton, !isPomodoro],
            [this._pomodoroModeButton, isPomodoro],
        ]) {
            if (selected)
                button.add_style_class_name('selected');
            else
                button.remove_style_class_name('selected');
        }
    }

    _save() {
        this._captureCustomPomodoro();

        if (this._pomodoro.presetId === 'custom')
            this._pomodoro = {...this._customPomodoro};

        this._onSave(createTimerSettings({
            mode: this._mode,
            normalMinutes: normalizeTimerPresets(this._normalEntries.map(entryText)),
            pomodoro: this._pomodoro,
        }));
        this._closeAndDestroy();
    }

    _cancel() {
        this._closeAndDestroy();
    }

    _closeAndDestroy() {
        const onClose = this._onClose;

        this._onClose = null;
        this.close();
        onClose?.();
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;

        this._normalModeButton?.disconnectObject(this);
        this._pomodoroModeButton?.disconnectObject(this);
        this._presetButton?.disconnectObject(this);

        this._normalModeButton?.destroy();
        this._pomodoroModeButton?.destroy();
        this._presetButton?.destroy();
        this._presetList?.destroy();
        this._presetSummary?.destroy();
        this._customPanel?.destroy();
        this._modeRow?.destroy();
        this._normalPanel?.destroy();
        this._pomodoroPanel?.destroy();

        this._normalModeButton = null;
        this._pomodoroModeButton = null;
        this._presetButton = null;
        this._presetList = null;
        this._presetSummary = null;
        this._customPanel = null;
        this._modeRow = null;
        this._normalPanel = null;
        this._pomodoroPanel = null;
        this._normalEntries = null;
        this._customNameEntry = null;
        this._customFocusEntry = null;
        this._customBreakEntry = null;
        this._onSave = null;
        this._onClose = null;

        super.destroy();
    }
});

const TimerMessageSource = GObject.registerClass({
    Properties: {
        'title': GObject.ParamSpec.string(
            'title',
            null,
            null,
            GObject.ParamFlags.READWRITE,
            'Timer'
        ),
        'icon': GObject.ParamSpec.object(
            'icon',
            null,
            null,
            GObject.ParamFlags.READWRITE,
            Gio.Icon
        ),
    },
}, class TimerMessageSource extends GObject.Object {
    _init() {
        super._init();

        this._title = 'Timer';
        this._icon = new Gio.ThemedIcon({name: 'alarm-symbolic'});
    }

    get title() {
        return this._title;
    }

    set title(value) {
        if (this._title === value)
            return;

        this._title = value;
        this.notify('title');
    }

    get icon() {
        return this._icon;
    }

    set icon(value) {
        if (this._icon === value)
            return;

        this._icon = value;
        this.notify('icon');
    }
});

const TimerMessage = GObject.registerClass(
class TimerMessage extends MessageList.Message {
    constructor(handlers) {
        const source = new TimerMessageSource();
        super(source);

        this._source = source;
        this._handlers = handlers;
        this.add_style_class_name('clocks-timer-message');

        this._pauseResumeButton = this.addMediaControl(
            'media-playback-pause-symbolic',
            () => this._handlers?.pauseResume()
        );
        this._resetButton = this.addMediaControl(
            'view-refresh-symbolic',
            () => this._handlers?.reset()
        );

        this._durationRow = new St.BoxLayout({
            style_class: 'clocks-timer-duration-row',
            x_expand: true,
        });
        this._presetButtonBox = new St.BoxLayout({
            style_class: 'clocks-timer-preset-button-box',
            x_expand: true,
        });
        this._durationRow.add_child(this._presetButtonBox);

        this._settingsButton = new St.Button({
            child: new St.Icon({icon_name: 'preferences-system-symbolic'}),
            style_class: 'clocks-timer-settings-button',
            can_focus: true,
            accessible_name: 'Timer settings',
        });
        this._settingsButton.connectObject(
            'clicked', () => this._handlers?.settings(), this);
        this._durationRow.add_child(this._settingsButton);
        this._durationButtons = [];
        this._launcherSignature = '';
        this.setActionArea(this._durationRow);

        this.set({
            title: 'Timer',
            body: '',
            icon: new Gio.ThemedIcon({name: 'alarm-symbolic'}),
        });
    }

    _renderDurationButtons(profile) {
        const launcherMinutes = profile.launcherMinutes ?? [];
        const signature = `${profile.mode}:${launcherMinutes.join(',')}`;

        if (signature === this._launcherSignature)
            return;

        this._launcherSignature = signature;
        for (const {button} of this._durationButtons)
            button.destroy();

        this._durationButtons = launcherMinutes.map(minutes => {
            const button = new St.Button({
                label: `${minutes} min`,
                style_class: 'clocks-timer-duration-button',
                can_focus: true,
                x_expand: true,
            });
            button.accessible_name = profile.mode === 'pomodoro'
                ? `Start ${minutes} minute focus timer`
                : `Start ${minutes} minute timer`;
            button.connectObject(
                'clicked', () => this._handlers?.durationSelected(minutes), this);
            this._presetButtonBox.add_child(button);
            return {minutes, button};
        });
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;

        this._settingsButton?.disconnectObject(this);
        for (const {button} of this._durationButtons ?? []) {
            button.disconnectObject(this);
            button.destroy();
        }

        this._settingsButton?.destroy();
        this._presetButtonBox?.destroy();
        this._durationRow?.destroy();
        this._pauseResumeButton?.destroy();
        this._resetButton?.destroy();

        this._handlers = null;
        this._source = null;
        this._settingsButton = null;
        this._presetButtonBox = null;
        this._durationRow = null;
        this._pauseResumeButton = null;
        this._resetButton = null;
        this._durationButtons = null;

        super.destroy();
    }

    update(summary, profile) {
        this._renderDurationButtons(profile);
        this.title = summary.title;
        this.body = summary.body;
        this._pauseResumeButton.child.icon_name = summary.primaryAction === 'pause'
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';
        this._pauseResumeButton.accessible_name = {
            start: 'Start timer',
            resume: 'Resume timer',
            pause: 'Pause timer',
        }[summary.primaryAction];
        this._resetButton.visible = summary.mode !== 'launcher';
        this._resetButton.accessible_name = 'Reset timer';
        this._durationRow.visible = summary.mode === 'launcher';
        for (const {minutes, button} of this._durationButtons) {
            if (minutes === profile.selectedMinutes)
                button.add_style_class_name('selected');
            else
                button.remove_style_class_name('selected');
        }
    }
});

export default class NotificationCenterTimerExtension extends Extension {
    enable() {
        this._dateMenu = Main.panel.statusArea.dateMenu;
        this._timer = null;
        this._settingsStore = null;
        this._settings = createTimerSettings();
        this._selectedMinutes = this._settings.normalMinutes[0];
        this._timerPhase = 'focus';
        this._tickId = 0;
        this._menuOpenChangedId = 0;
        this._timerMessage = null;
        this._settingsDialog = null;

        if (!this._dateMenu) {
            log(`${LOG_PREFIX} Date menu was not found`);
            return;
        }

        this._settingsStore = this.getSettings();
        this._settings = this._readStoredSettings();
        this._selectedMinutes = this._settings.normalMinutes[0];
        this._installTopBarTimer();
        this._menuOpenChangedId = this._dateMenu.menu.connect(
            'open-state-changed',
            () => this._render()
        );
        this._render();
    }

    disable() {
        this._stopTick();
        this._settingsDialog?.close();
        this._settingsDialog = null;
        this._removeTimerMessage();
        this._removeTopBarTimer();

        if (this._menuOpenChangedId) {
            this._dateMenu?.menu.disconnect(this._menuOpenChangedId);
            this._menuOpenChangedId = 0;
        }

        this._timer = null;
        this._settingsStore = null;
        this._dateMenu = null;
    }

    _installTopBarTimer() {
        const clockDisplay = this._dateMenu?._clockDisplay;
        const clockBox = clockDisplay?.get_parent?.();

        if (!clockDisplay || !clockBox?.insert_child_at_index) {
            log(`${LOG_PREFIX} Could not find clock display box`);
            return;
        }

        const children = clockBox.get_children();
        const insertIndex = children.indexOf(clockDisplay) + 1;

        this._topSeparator = new St.Label({
            text: ' | ',
            style_class: 'clocks-timer-top-separator',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._topIcon = new St.Icon({
            icon_name: 'alarm-symbolic',
            style_class: 'system-status-icon clocks-timer-top-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._topLabel = new St.Label({
            style_class: 'clocks-timer-top-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._topLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

        clockBox.insert_child_at_index(this._topSeparator, insertIndex);
        clockBox.insert_child_at_index(this._topIcon, insertIndex + 1);
        clockBox.insert_child_at_index(this._topLabel, insertIndex + 2);
    }

    _removeTopBarTimer() {
        this._topSeparator?.destroy();
        this._topIcon?.destroy();
        this._topLabel?.destroy();

        this._topSeparator = null;
        this._topIcon = null;
        this._topLabel = null;
    }

    _currentProfile() {
        return {
            ...timerProfileFromSettings(this._settings, this._timerPhase),
            selectedMinutes: this._selectedMinutes,
        };
    }

    _readStoredSettings() {
        if (!this._settingsStore)
            return createTimerSettings();

        return createTimerSettings({
            mode: this._settingsStore.get_string('mode'),
            normalMinutes: this._settingsStore.get_value('normal-minutes').deep_unpack(),
            pomodoro: {
                presetId: this._settingsStore.get_string('pomodoro-preset'),
                name: this._settingsStore.get_string('pomodoro-name'),
                focusMinutes: this._settingsStore.get_int('pomodoro-focus-minutes'),
                breakMinutes: this._settingsStore.get_int('pomodoro-break-minutes'),
            },
        });
    }

    _saveStoredSettings() {
        if (!this._settingsStore)
            return;

        this._settingsStore.set_string('mode', this._settings.mode);
        this._settingsStore.set_value(
            'normal-minutes',
            new GLib.Variant('ai', this._settings.normalMinutes)
        );
        this._settingsStore.set_string('pomodoro-preset', this._settings.pomodoro.presetId);
        this._settingsStore.set_string('pomodoro-name', this._settings.pomodoro.name);
        this._settingsStore.set_int('pomodoro-focus-minutes', this._settings.pomodoro.focusMinutes);
        this._settingsStore.set_int('pomodoro-break-minutes', this._settings.pomodoro.breakMinutes);
    }

    _timerDurationSeconds() {
        const profile = this._currentProfile();
        const durationMinutes = profile.mode === TIMER_MODES.POMODORO
            ? profile.phase === 'break' ? profile.breakMinutes : profile.focusMinutes
            : this._selectedMinutes;

        return timerSecondsFromMinutes(durationMinutes);
    }

    _setTimerMinutes(value) {
        const minutes = normalizeTimerMinutes(value, this._selectedMinutes);

        if (minutes === this._selectedMinutes)
            return;

        this._selectedMinutes = minutes;
    }

    _startPresetTimer(minutes) {
        if (this._settings.mode === TIMER_MODES.POMODORO) {
            this._timerPhase = 'focus';
            this._startConfiguredTimer();
            return;
        }

        this._setTimerMinutes(minutes);
        this._startConfiguredTimer();
    }

    _startConfiguredTimer() {
        this._startTimer(this._timerDurationSeconds());
    }

    _activatePrimaryTimerAction() {
        if (!this._timer) {
            this._startConfiguredTimer();
            return;
        }

        this._pauseResumeTimer();
    }

    _startTimer(durationSeconds) {
        this._timer = createTimerState(
            durationSeconds,
            GLib.get_monotonic_time(),
            GLib.USEC_PER_SEC
        );

        this._startTick();
        this._render();
    }

    _pauseResumeTimer() {
        if (!this._timer)
            return;

        if (this._timer.paused) {
            this._timer = resumeTimerState(
                this._timer,
                GLib.get_monotonic_time(),
                GLib.USEC_PER_SEC
            );
            this._startTick();
        } else {
            this._timer = pauseTimerState(
                this._timer,
                GLib.get_monotonic_time(),
                GLib.USEC_PER_SEC
            );
            this._stopTick();
        }

        this._render();
    }

    _resetTimer() {
        this._finishTimer(false);
    }

    _startTick() {
        if (this._tickId)
            return;

        this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_INTERVAL_MS, () => {
            if (!this._timer || this._timer.paused) {
                this._tickId = 0;
                return GLib.SOURCE_REMOVE;
            }

            if (this._remainingSeconds() <= 0) {
                this._tickId = 0;
                this._finishTimer(true);
                return GLib.SOURCE_REMOVE;
            }

            this._render();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopTick() {
        if (!this._tickId)
            return;

        GLib.Source.remove(this._tickId);
        this._tickId = 0;
    }

    _finishTimer(notify) {
        this._stopTick();
        const profile = this._currentProfile();

        if (notify && profile.mode === TIMER_MODES.POMODORO && profile.phase === 'focus') {
            this._timerPhase = 'break';
            Main.notify(`${profile.label} focus complete`, `Break: ${profile.breakMinutes} min`);
            this._startConfiguredTimer();
            return;
        }

        this._timer = null;
        this._timerPhase = 'focus';
        this._render();

        if (notify) {
            const message = profile.mode === TIMER_MODES.POMODORO
                ? `${profile.label} break complete`
                : 'Timer countdown finished';
            Main.notify('Notification Center Timer', message);
        }
    }

    _remainingSeconds() {
        return timerRemainingSeconds(
            this._timer,
            GLib.get_monotonic_time(),
            GLib.USEC_PER_SEC
        );
    }

    _currentTimerState() {
        return displayTimerState(
            this._timer,
            GLib.get_monotonic_time(),
            GLib.USEC_PER_SEC
        );
    }

    _render() {
        const state = this._currentTimerState();
        const profile = this._currentProfile();
        const showTopBarTimer = shouldShowTopBarTimer(state, this._dateMenu?.menu?.isOpen);

        if (this._topSeparator)
            this._topSeparator.visible = showTopBarTimer;
        if (this._topIcon)
            this._topIcon.visible = showTopBarTimer;
        if (this._topLabel) {
            this._topLabel.visible = showTopBarTimer;
            this._topLabel.text = state
                ? formatTimerProgress(state.remainingSeconds, state.durationSeconds)
                : '';
        }

        this._ensureTimerMessage();
        const launcherMinutes = profile.mode === TIMER_MODES.POMODORO
            ? profile.focusMinutes
            : this._selectedMinutes;
        this._timerMessage?.update(
            timerMessageSummary(state, launcherMinutes, profile),
            profile
        );
        this._ensureTimerMessagePosition();
    }

    _openSettings() {
        if (this._settingsDialog)
            return;

        this._settingsDialog = new TimerSettingsDialog(
            this._settings,
            settings => this._applySettings(settings),
            () => this._settingsDialog = null
        );
        this._settingsDialog.open();
    }

    _applySettings(settings) {
        this._settings = settings;
        this._saveStoredSettings();
        this._timerPhase = 'focus';
        this._selectedMinutes = settings.mode === TIMER_MODES.POMODORO
            ? settings.pomodoro.focusMinutes
            : settings.normalMinutes[0];
        this._render();
    }

    _messageView() {
        return this._dateMenu?._messageList?._messageView ?? null;
    }

    _timerMessageIndex(messageView) {
        return messageView?._playerToMessage?.size ?? 0;
    }

    _ensureTimerMessage() {
        const messageView = this._messageView();

        if (!messageView?._addMessageAtIndex || this._timerMessage)
            return;

        this._timerMessage = new TimerMessage({
            pauseResume: () => this._activatePrimaryTimerAction(),
            reset: () => this._resetTimer(),
            durationSelected: minutes => this._startPresetTimer(minutes),
            settings: () => this._openSettings(),
        });
        this._timerMessage.connectObject('destroy', () => {
            this._timerMessage = null;
        }, this);

        messageView._addMessageAtIndex(
            this._timerMessage,
            this._timerMessageIndex(messageView)
        );
    }

    _ensureTimerMessagePosition() {
        const messageView = this._messageView();
        const message = this._timerMessage;

        if (!messageView?.messages || !messageView?._moveMessage || !message)
            return;

        const currentIndex = messageView.messages.indexOf(message);
        const targetIndex = this._timerMessageIndex(messageView);

        if (currentIndex >= 0 && currentIndex !== targetIndex)
            messageView._moveMessage(message, targetIndex);
    }

    _removeTimerMessage() {
        const messageView = this._messageView();
        const message = this._timerMessage;

        if (!message)
            return;

        message.disconnectObject(this);
        this._timerMessage = null;

        if (messageView?.messages?.includes(message) && messageView?._removeMessage) {
            messageView._removeMessage(message);
            return;
        }

        message.destroy();
    }

}
