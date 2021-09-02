import { ErrorDetails, ErrorTypes } from '../errors';
import { Events } from '../events';
import Hls, { HlsConfig } from '../hls';
import { LevelDetails } from '../loader/level-details';
import { ComponentAPI } from '../types/component-api';
import { ErrorData } from '../types/events';
import { Level } from '../types/level';

type Stall = {
  type: string;
  details: string;
  currentLevel: number;
  startTimestamp: number;
  endTimestamp?: number;
};

type LowLatencyFailoverConfig = {
  llFailoverEnabled: boolean;
  targetLLFailoverLevelSelector: (levels: Level[]) => number;
  llFailoverTimeWindow: number;
  llFailoverStallCount: number;
  llFailoverStallRatio: number;
};

type HlsWithLowLatencyFailover = Hls & {
  config: HlsConfig & Partial<LowLatencyFailoverConfig>;
};

const isLowLatencyStream = (levelDetails: LevelDetails) =>
  levelDetails.live && !!levelDetails.partList;
const DEFAULT_TARGET_LL_FAILOVER_LEVEL_SELECTOR = (levels: Level[] = []) =>
  Math.floor(levels.length / 2);
const DEFAULT_LL_FAILOVER_TIME_WINDOW = 60000;
const DEFAULT_LL_FAILOVER_STALL_COUNT = 5;
const DEFAULT_LL_FAILOVER_STALLED_RATIO = 0.05;

const finalizeLastStall = (stalls: Stall[], detailType: ErrorDetails) => {
  const stall = stalls.reverse().find(({ details }) => details === detailType);
  if (stall) {
    stall.endTimestamp = Date.now();
  }
  return stalls;
};

const relevantErrorTypes = [ErrorTypes.MEDIA_ERROR, ErrorTypes.NETWORK_ERROR];
const relevantErrorDetails = [
  ErrorDetails.BUFFER_STALLED_ERROR,
  ErrorDetails.LEVEL_LOAD_TIMEOUT,
];
const isRelevantError = ({ type, details }: ErrorData) =>
  relevantErrorTypes.includes(type) && relevantErrorDetails.includes(details);

const StallEventTypeMap = {
  [ErrorDetails.BUFFER_STALLED_ERROR]: Events.FRAG_BUFFERED,
  [ErrorDetails.LEVEL_LOAD_TIMEOUT]: Events.LEVEL_LOADED,
};

const getWindowStart = (
  llFailoverTimeWindow = DEFAULT_LL_FAILOVER_TIME_WINDOW
) => Date.now() - llFailoverTimeWindow;

const getStallRatio = (stalls: Stall[], llFailoverTimeWindow: number) => {
  const windowStart = getWindowStart(llFailoverTimeWindow);
  const now = Date.now();
  const totalStallDuration = stalls.reduce(
    (prevTotalDuration, { startTimestamp, endTimestamp = now }) => {
      if (endTimestamp < windowStart) return prevTotalDuration;

      const duration =
        startTimestamp < windowStart
          ? endTimestamp - windowStart
          : endTimestamp - startTimestamp;

      return prevTotalDuration + duration;
    },
    0
  );
  const stallRatio = totalStallDuration / llFailoverTimeWindow;
  console.warn(
    '!!!!! stall info',
    'totalStallDuration (ms)',
    totalStallDuration,
    'llFailoverTimeWindow (ms)',
    llFailoverTimeWindow,
    'stallRatio',
    stallRatio
  );
  console.warn('!!!!! stall info', 'stalls', ...stalls);
  return stallRatio;
};

const pruneStallsByTimeWindow = (
  stalls: Stall[],
  llFailoverTimeWindow: number
) => {
  const windowStart = getWindowStart(llFailoverTimeWindow);
  return stalls.filter(
    ({ endTimestamp }) => !endTimestamp || endTimestamp >= windowStart
  );
};

export class LowLatencyFailoverController implements ComponentAPI {
  protected hls: HlsWithLowLatencyFailover;
  protected targetLLFailoverLevel = -1;
  protected llFailoverTimeWindow = Number.POSITIVE_INFINITY;
  protected llFailoverStallCount = Number.POSITIVE_INFINITY;
  protected llFailoverStallRatio = Number.POSITIVE_INFINITY;
  protected stalls: Stall[] = [];

  constructor(hls: HlsWithLowLatencyFailover) {
    this.hls = hls;
    const { llFailoverEnabled = true } = hls.config;

    // Before applying any logic, first determine:
    // 1. Are we configured for lowLatencyMode?
    if (hls.lowLatencyMode && llFailoverEnabled) {
      // 2. Wait until the first level is loaded to determine if we're playing a low latency stream
      hls.once(Events.LEVEL_LOADED, this.onLevelLoaded, this);
    }
  }

  protected onLevelLoaded(_eventType, data) {
    const { details } = data;
    if (!isLowLatencyStream(details)) return;
    const { hls } = this;
    const { config } = hls;
    // 3. Since we are both in lowLatencyMode and are playing a low latency stream, start monitoring
    // for failover conditions.
    this.targetLLFailoverLevel =
      config.targetLLFailoverLevelSelector?.(hls.levels) ??
      DEFAULT_TARGET_LL_FAILOVER_LEVEL_SELECTOR(hls.levels);
    this.llFailoverTimeWindow =
      config.llFailoverTimeWindow ?? DEFAULT_LL_FAILOVER_TIME_WINDOW;
    this.llFailoverStallCount =
      config.llFailoverStallCount ?? DEFAULT_LL_FAILOVER_STALL_COUNT;
    this.llFailoverStallRatio =
      config.llFailoverStallRatio ?? DEFAULT_LL_FAILOVER_STALLED_RATIO;
    hls.on(Events.ERROR, this.onError, this);
  }

  protected onError(_eventType, data) {
    const {
      hls,
      targetLLFailoverLevel,
      llFailoverTimeWindow,
      llFailoverStallCount,
      llFailoverStallRatio,
      stalls,
    } = this;
    if (!isRelevantError(data)) return;
    const level = hls.nextAutoLevel;
    if (level > targetLLFailoverLevel) return;

    this.stalls = pruneStallsByTimeWindow(stalls, llFailoverTimeWindow);
    const { type, details } = data;
    console.warn(
      '!!!!! stall info',
      'finalizing last stall',
      'details',
      details,
      'StallEventTypeMap[details]',
      StallEventTypeMap[details]
    );
    stalls.push({
      type,
      details,
      currentLevel: level,
      startTimestamp: Date.now(),
    });

    if (stalls.length >= llFailoverStallCount) {
      hls.lowLatencyMode = false;
      hls.off(Events.ERROR, this.onError, this);
      console.warn(
        'Cannot keep up with low latency mode. Attempting non-low latency playback!'
      );
      return;
    }

    hls.once(StallEventTypeMap[details], (_eventType, _data) => {
      console.warn(
        '!!!!! stall info',
        'finalizing last stall',
        'details',
        details,
        'StallEventTypeMap[details]',
        StallEventTypeMap[details]
      );
      console.warn('!!!!! stall info', 'stalls', ...stalls);
      this.stalls = finalizeLastStall(stalls, details);
      const stallRatio = getStallRatio(stalls, llFailoverTimeWindow);
      if (stallRatio >= llFailoverStallRatio) {
        hls.lowLatencyMode = false;
        hls.off(Events.ERROR, this.onError, this);
        console.warn(
          'Cannot keep up with low latency mode. Attempting non-low latency playback!'
        );
      }
    });
    console.log('drift', hls.drift);
    console.log('latency', hls.latency);
  }

  public destroy() {
    const { hls } = this;
    hls.off(Events.ERROR, this.onError, this);
    // hls.off(Events.LEVEL_LOADED, this.onLevelLoaded, this);
  }
}
