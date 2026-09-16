export const DEFAULT_TIMER_SECONDS = 60;
export const DEFAULT_NORMAL_TIMER_MINUTES = [5, 15, 30];
export const TIMER_PRESET_MINUTES = DEFAULT_NORMAL_TIMER_MINUTES;
export const DEFAULT_TIMER_MINUTES = TIMER_PRESET_MINUTES[0];
export const MAX_TIMER_MINUTES = 1440;
export const TIMER_MODES = {
    NORMAL: 'normal',
    POMODORO: 'pomodoro',
};

export const POMODORO_PRESETS = [
    {id: 'classic', name: 'Classic', focusMinutes: 25, breakMinutes: 5},
    {id: 'short', name: 'Short Focus', focusMinutes: 15, breakMinutes: 3},
    {id: 'medium', name: 'Medium Focus', focusMinutes: 30, breakMinutes: 5},
    {id: 'extended', name: 'Extended Focus', focusMinutes: 50, breakMinutes: 10},
    {id: 'deep-work', name: 'Deep Work', focusMinutes: 90, breakMinutes: 15},
    {id: 'custom', name: 'Custom', focusMinutes: 25, breakMinutes: 5},
];

function positiveInteger(value) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return null;

    const seconds = Math.floor(value);
    return seconds > 0 ? seconds : null;
}

export function normalizeTimerMinutes(value, fallbackMinutes = DEFAULT_TIMER_MINUTES) {
    const fallback = positiveInteger(fallbackMinutes) ?? DEFAULT_TIMER_MINUTES;
    const numericValue = typeof value === 'string' && value.trim() !== ''
        ? Number(value.trim())
        : value;
    const minutes = positiveInteger(numericValue) ?? fallback;

    return Math.min(minutes, MAX_TIMER_MINUTES);
}

export function normalizeTimerPresets(values, fallbackValues = DEFAULT_NORMAL_TIMER_MINUTES) {
    const normalized = [];

    if (Array.isArray(values)) {
        for (const value of values) {
            const numericValue = typeof value === 'string' && value.trim() !== ''
                ? Number(value.trim())
                : value;
            const minutes = Math.min(positiveInteger(numericValue) ?? 0, MAX_TIMER_MINUTES);

            if (!minutes || normalized.includes(minutes))
                continue;

            normalized.push(minutes);

            if (normalized.length === 3)
                break;
        }
    }

    if (normalized.length > 0)
        return normalized;

    return Array.isArray(fallbackValues) && fallbackValues.length > 0
        ? normalizeTimerPresets(fallbackValues, DEFAULT_NORMAL_TIMER_MINUTES)
        : DEFAULT_NORMAL_TIMER_MINUTES.slice();
}

function pomodoroPresetById(presetId) {
    return POMODORO_PRESETS.find(preset => preset.id === presetId) ?? POMODORO_PRESETS[0];
}

function normalizeTimerName(name, fallbackName) {
    const normalized = typeof name === 'string' ? name.trim() : '';
    return (normalized || fallbackName).slice(0, 48);
}

export function normalizePomodoroSettings(settings = {}) {
    const preset = pomodoroPresetById(settings?.presetId);
    const isCustom = preset.id === 'custom';

    return {
        presetId: preset.id,
        name: isCustom ? normalizeTimerName(settings?.name, preset.name) : preset.name,
        focusMinutes: normalizeTimerMinutes(settings?.focusMinutes, preset.focusMinutes),
        breakMinutes: normalizeTimerMinutes(settings?.breakMinutes, preset.breakMinutes),
    };
}

export function createTimerSettings(settings = {}) {
    return {
        mode: settings?.mode === TIMER_MODES.POMODORO
            ? TIMER_MODES.POMODORO
            : TIMER_MODES.NORMAL,
        normalMinutes: normalizeTimerPresets(settings?.normalMinutes),
        pomodoro: normalizePomodoroSettings(settings?.pomodoro),
    };
}

export function timerProfileFromSettings(settings, phase = 'focus') {
    const normalizedSettings = createTimerSettings(settings);

    if (normalizedSettings.mode === TIMER_MODES.NORMAL) {
        return {
            mode: TIMER_MODES.NORMAL,
            label: 'Timer',
            launcherMinutes: normalizedSettings.normalMinutes,
            phase: 'normal',
        };
    }

    const pomodoro = normalizedSettings.pomodoro;

    return {
        mode: TIMER_MODES.POMODORO,
        label: pomodoro.name,
        launcherMinutes: [pomodoro.focusMinutes],
        focusMinutes: pomodoro.focusMinutes,
        breakMinutes: pomodoro.breakMinutes,
        phase: phase === 'break' ? 'break' : 'focus',
    };
}

export function timerSecondsFromMinutes(minutes, fallbackMinutes = DEFAULT_TIMER_MINUTES) {
    return normalizeTimerMinutes(minutes, fallbackMinutes) * 60;
}

export function formatDurationCompact(totalSeconds) {
    const seconds = positiveInteger(totalSeconds) ?? DEFAULT_TIMER_SECONDS;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    if (hours > 0 && minutes > 0)
        return `${hours} hr ${minutes} min`;
    if (hours > 0)
        return `${hours} hr`;
    if (minutes > 0 && remainingSeconds > 0)
        return `${minutes} min ${remainingSeconds} sec`;
    if (minutes > 0)
        return `${minutes} min`;

    return `${remainingSeconds} sec`;
}

export function formatTimerClock(totalSeconds) {
    const seconds = Math.max(0, Math.floor(totalSeconds ?? 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    const paddedSeconds = `${remainingSeconds}`.padStart(2, '0');

    if (hours > 0)
        return `${hours}:${`${minutes}`.padStart(2, '0')}:${paddedSeconds}`;

    return `${minutes}:${paddedSeconds}`;
}

export function formatTimerProgress(remainingSeconds, durationSeconds) {
    return `${formatTimerClock(remainingSeconds)} / ${formatTimerClock(durationSeconds)}`;
}

export function timerMessageSummary(
    displayState,
    durationMinutes = DEFAULT_TIMER_MINUTES,
    profile = null
) {
    const label = typeof profile === 'string' ? profile : profile?.label ?? 'Timer';
    const mode = profile?.mode ?? TIMER_MODES.NORMAL;
    const phase = profile?.phase ?? 'focus';
    if (!displayState) {
        const durationSeconds = timerSecondsFromMinutes(durationMinutes);
        const body = mode === TIMER_MODES.POMODORO
            ? `Ready for ${formatDurationCompact(durationSeconds)} focus / ` +
                `${formatDurationCompact(timerSecondsFromMinutes(profile.breakMinutes))} break`
            : `Ready for ${formatDurationCompact(durationSeconds)}`;

        return {
            mode: 'launcher',
            title: label,
            body,
            primaryAction: 'start',
        };
    }

    const progress = formatTimerProgress(displayState.remainingSeconds, displayState.durationSeconds);
    const phaseLabel = mode === TIMER_MODES.POMODORO && phase === 'break' ? ' break' : '';

    if (displayState.paused) {
        return {
            mode: 'paused',
            title: `${label} paused`,
            body: `${progress}${phaseLabel} paused`,
            primaryAction: 'resume',
        };
    }

    return {
        mode: 'running',
        title: `${label} running`,
        body: `${progress}${phaseLabel} remaining`,
        primaryAction: 'pause',
    };
}

export function createTimerState(durationSeconds, nowUsec, usecPerSec = 1_000_000) {
    const duration = positiveInteger(durationSeconds) ?? DEFAULT_TIMER_SECONDS;

    return {
        durationSeconds: duration,
        endsAtUsec: nowUsec + duration * usecPerSec,
        paused: false,
        pausedRemainingSeconds: 0,
    };
}

export function timerRemainingSeconds(timer, nowUsec, usecPerSec = 1_000_000) {
    if (!timer)
        return 0;

    if (timer.paused)
        return Math.max(0, timer.pausedRemainingSeconds ?? 0);

    return Math.max(0, Math.ceil((timer.endsAtUsec - nowUsec) / usecPerSec));
}

export function pauseTimerState(timer, nowUsec, usecPerSec = 1_000_000) {
    if (!timer || timer.paused)
        return timer;

    return {
        ...timer,
        paused: true,
        pausedRemainingSeconds: timerRemainingSeconds(timer, nowUsec, usecPerSec),
    };
}

export function resumeTimerState(timer, nowUsec, usecPerSec = 1_000_000) {
    if (!timer || !timer.paused)
        return timer;

    const remainingSeconds = timerRemainingSeconds(timer, nowUsec, usecPerSec);

    return {
        ...timer,
        endsAtUsec: nowUsec + remainingSeconds * usecPerSec,
        paused: false,
        pausedRemainingSeconds: 0,
    };
}

export function displayTimerState(timer, nowUsec, usecPerSec = 1_000_000) {
    if (!timer)
        return null;

    return {
        durationSeconds: timer.durationSeconds,
        remainingSeconds: timerRemainingSeconds(timer, nowUsec, usecPerSec),
        paused: timer.paused,
    };
}

export function shouldShowTopBarTimer(displayState, dateMenuOpen) {
    return Boolean(
        displayState &&
        displayState.remainingSeconds > 0 &&
        !displayState.paused &&
        !dateMenuOpen
    );
}
