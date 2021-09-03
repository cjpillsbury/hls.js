import { ErrorDetails, ErrorTypes } from '../errors';
import { Events } from '../events';
import Hls from '../hls';
import { LevelDetails } from '../loader/level-details';
import { ComponentAPI } from '../types/component-api';
import { ErrorData, FragBufferedData, LevelLoadedData } from '../types/events';
import { Level } from '../types/level';
import { PlaylistLevelType } from '../types/loader';

type BaseStall<T extends ErrorTypes, D extends ErrorDetails> = {
  type: T;
  details: D;
  currentLevel: number;
  startTimestamp: number;
  endTimestamp?: number;
};

// A fragment stall represents the time between a stall in fragment buffering and the first successfully loaded main fragment thereafter.
type FragmentStall = BaseStall<
  ErrorTypes.MEDIA_ERROR,
  ErrorDetails.BUFFER_STALLED_ERROR
>;
// A level stall represents the time between a a failed attempt to load a (level) playlist due to timeout and the first successfully loaded (level) playlist thereafter.
type LevelStall = BaseStall<
  ErrorTypes.NETWORK_ERROR,
  ErrorDetails.LEVEL_LOAD_TIMEOUT
>;
type Stall = FragmentStall | LevelStall;

type LowLatencyFailoverConfig = {
  // determines if low latency failover functionality is enabled/disabled altogether
  llFailoverEnabled: boolean;
  // function to determine the "threshold level" for low latency failover monitoring. If stalls are occurring
  // at higher levels, assume ABR and other level switching/buffering logic will handle it to allow playback
  // to stay close to the live edge, even at a potentially downgraded quality
  targetLLFailoverLevelSelector: (levels: Level[]) => number;
  // a sliding range time window from "now", represented in milliseconds, for monitoring stall metrics to
  // determine if we should failover to non-low latency playback
  llFailoverTimeWindow: number;
  // a positive integer representing the threshold of number of stalls within the sliding time window
  // before failover occurs
  llFailoverStallCount: number;
  // a fractional number between 0-1 representing the threshold of stalled/unstalled time within the sliding
  // time window before failover occurs.
  llFailoverStallRatio: number;
};

const DEFAULT_LL_FAILOVER_ENABLED = true;
const DEFAULT_TARGET_LL_FAILOVER_LEVEL_SELECTOR = (levels: Level[] = []) =>
  Math.floor(levels.length / 2);
const DEFAULT_LL_FAILOVER_TIME_WINDOW = 60000;
const DEFAULT_LL_FAILOVER_STALL_COUNT = 5;
const DEFAULT_LL_FAILOVER_STALLED_RATIO = 0.1;

const hlsLLFailoverDefaultConfig: LowLatencyFailoverConfig = {
  llFailoverEnabled: DEFAULT_LL_FAILOVER_ENABLED,
  targetLLFailoverLevelSelector: DEFAULT_TARGET_LL_FAILOVER_LEVEL_SELECTOR,
  llFailoverTimeWindow: DEFAULT_LL_FAILOVER_TIME_WINDOW,
  llFailoverStallCount: DEFAULT_LL_FAILOVER_STALL_COUNT,
  llFailoverStallRatio: DEFAULT_LL_FAILOVER_STALLED_RATIO,
};

enum LLFailoverEnum {
  LOW_LATENCY_FAILOVER_DETAIL = 'lowLatencyFailover',
}

const isLowLatencyStream = (levelDetails: LevelDetails) =>
  levelDetails.live && !!levelDetails.partList;

const finalizeLastStall = (stalls: Stall[], detailType: StallDetails) => {
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

type EventData = {
  [Events.LEVEL_LOADED]: LevelLoadedData;
  [Events.FRAG_BUFFERED]: FragBufferedData;
};

const isRelevantUnstalledEvent = <K extends keyof EventData>(
  eventType: K,
  data: EventData[K]
): boolean => {
  if (eventType === Events.LEVEL_LOADED) return true;
  if (eventType === Events.FRAG_BUFFERED) {
    return (
      (data as EventData[Events.FRAG_BUFFERED]).frag.type ===
      PlaylistLevelType.MAIN
    );
  }
  return false;
};

const StallEventTypeMap = {
  [ErrorDetails.BUFFER_STALLED_ERROR]: Events.FRAG_BUFFERED,
  [ErrorDetails.LEVEL_LOAD_TIMEOUT]: Events.LEVEL_LOADED,
};

type StallDetails = keyof typeof StallEventTypeMap;

const getWindowStart = (
  llFailoverTimeWindow = DEFAULT_LL_FAILOVER_TIME_WINDOW
) => Date.now() - llFailoverTimeWindow;

const getStallRatio = (
  stalls: Stall[],
  llFailoverTimeWindow: number,
  stallDetails: StallDetails
) => {
  const windowStart = getWindowStart(llFailoverTimeWindow);
  const now = Date.now();
  const totalStallDuration = stalls
    .filter(({ details }) => details === stallDetails)
    .reduce((prevTotalDuration, { startTimestamp, endTimestamp = now }) => {
      if (endTimestamp < windowStart) return prevTotalDuration;

      const duration =
        startTimestamp < windowStart
          ? endTimestamp - windowStart
          : endTimestamp - startTimestamp;

      return prevTotalDuration + duration;
    }, 0);
  const stallRatio = totalStallDuration / llFailoverTimeWindow;
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

// Extending Hls to allow for new, ll failover config internally
type HlsWithLowLatencyFailover = Hls & {
  config: Hls['config'] & Partial<LowLatencyFailoverConfig>;
};

export class LowLatencyFailoverController implements ComponentAPI {
  protected hls: HlsWithLowLatencyFailover;
  protected targetLLFailoverLevelSelector =
    DEFAULT_TARGET_LL_FAILOVER_LEVEL_SELECTOR;
  protected targetLLFailoverLevel = 0;
  protected llFailoverTimeWindow = DEFAULT_LL_FAILOVER_TIME_WINDOW;
  protected llFailoverStallCount = DEFAULT_LL_FAILOVER_STALL_COUNT;
  protected llFailoverStallRatio = DEFAULT_LL_FAILOVER_STALLED_RATIO;
  protected stalls: Stall[] = [];
  protected intervalHandle: { [k in StallDetails]?: number } = {
    [ErrorDetails.BUFFER_STALLED_ERROR]: undefined,
    [ErrorDetails.LEVEL_LOAD_TIMEOUT]: undefined,
  };

  constructor(hls: HlsWithLowLatencyFailover) {
    this.hls = hls;
    const { config: hlsConfig } = hls;
    const config = { ...hlsLLFailoverDefaultConfig, ...hlsConfig };

    // Before applying any logic, first determine:
    // 1. Are we configured for lowLatencyMode and do we want to apply ll failover functionality?
    if (hls.lowLatencyMode && config.llFailoverEnabled) {
      this.targetLLFailoverLevelSelector = config.targetLLFailoverLevelSelector;
      this.llFailoverTimeWindow = config.llFailoverTimeWindow;
      this.llFailoverStallCount = config.llFailoverStallCount;
      this.llFailoverStallRatio = config.llFailoverStallRatio;
      // 2. Wait until the first level is loaded to determine if we're playing a low latency stream
      hls.once(Events.LEVEL_LOADED, this.onLevelLoaded, this);
    }

    // Make sure we destroy()/teardown when hls instance is destroying.
    hls.on(Events.DESTROYING, this.destroy, this);
  }

  protected onLevelLoaded(_eventType, data) {
    const { details } = data;
    if (!isLowLatencyStream(details)) return;
    const { hls } = this;
    // 3. Since we are in lowLatencyMode, want failover ll functionality, and are playing a low latency
    // stream, start monitoring for failover conditions.
    this.targetLLFailoverLevel = this.targetLLFailoverLevelSelector(hls.levels);
    hls.on(Events.ERROR, this.onError, this);
  }

  protected onError(_eventType, data) {
    const {
      hls,
      targetLLFailoverLevel,
      llFailoverTimeWindow,
      llFailoverStallCount,
    } = this;

    // Since we only care about certain stall-related errors, bail early
    // if this error is irrelevant
    if (!isRelevantError(data)) return;
    const level = hls.nextAutoLevel;

    // Since we only care about stalls for levels at or below our threshold,
    // bail early if this level is above the threshold.
    if (level > targetLLFailoverLevel) return;

    // Update our stalls list in case anything is now fully outside of our sliding
    // time window.
    this.stalls = pruneStallsByTimeWindow(this.stalls, llFailoverTimeWindow);

    const { type, details } = data;
    // Add the stall to the list of stalls, including when the stall began.
    this.stalls.push({
      type,
      details,
      currentLevel: level,
      startTimestamp: Date.now(),
    });

    // If we already have too many stalls, we can failover now
    if (this.stalls.length >= llFailoverStallCount) {
      this.abandonLowLatencyMode();
      return;
    }

    // Otherwise, start polling to check how long we've been stalled
    if (!this.intervalHandle[details]) {
      this.intervalHandle[details] = window.setInterval(
        this.pollStallRatio.bind(this),
        1000
      );
    }

    // NOTE: Would prefer to use "once", but since a media stall most
    // likely corresponds to a failure to keep up with loading+buffering
    // video/"main" fragments, we do not have a 1-1 between events.
    const hasListener = hls
      .listeners(StallEventTypeMap[details])
      .some((listener) => listener === this.onUnstalledEvent);

    if (!hasListener) {
      hls.on(StallEventTypeMap[details], this.onUnstalledEvent, this);
    }
  }

  protected onUnstalledEvent<T extends keyof EventData>(
    eventType: T,
    data: EventData[T]
  ): void {
    // If this isn't an event that counts as an "unstalled" for the corresponding
    // stall, don't do anything.
    if (!isRelevantUnstalledEvent(eventType, data)) return;

    // If this is an "unstalled" event for a previous stall, find the appropriate
    // detail to match it against.
    const [details] =
      Object.entries(StallEventTypeMap).find(
        ([_details, detailsEventType]) => detailsEventType === eventType
      ) ?? [];

    // NOTE: This should never occur in actuality, but adding here for TS enforcement
    if (!details) return;

    // Update the appropriate previous stall event with a timestamp to track the total
    // stall duration for that stall.
    this.stalls = finalizeLastStall(this.stalls, details as StallDetails);
    // If we've been stalled for too much time overall within the sliding time window,
    // abandon ll and use standard live playback instead.
    if (
      this.getStallRatio(details as StallDetails) >= this.llFailoverStallRatio
    ) {
      this.abandonLowLatencyMode();
    }

    // Since we've received the corresponding unstall event, clear out our monitoring
    // until it's re-initiative by the next stall
    window.clearInterval(this.intervalHandle[details]);
    this.intervalHandle[details] = undefined;
    this.hls.off(eventType, this.onUnstalledEvent, this);
  }

  protected pollStallRatio(details: StallDetails) {
    if (this.getStallRatio(details) >= this.llFailoverStallRatio) {
      this.abandonLowLatencyMode();
    }
  }

  public getStallRatio(
    details: StallDetails = ErrorDetails.BUFFER_STALLED_ERROR
  ) {
    const { stalls, llFailoverTimeWindow } = this;
    const stallRatio = getStallRatio(stalls, llFailoverTimeWindow, details);
    return stallRatio;
  }

  public abandonLowLatencyMode() {
    const { hls } = this;
    hls.lowLatencyMode = false;
    console.warn(
      'Cannot keep up with low latency mode. Abandoning & attempting non-low latency playback!',
      'stalls',
      this.stalls,
      'stallRatios',
      ErrorDetails.LEVEL_LOAD_TIMEOUT,
      this.getStallRatio(ErrorDetails.LEVEL_LOAD_TIMEOUT),
      ErrorDetails.BUFFER_STALLED_ERROR,
      this.getStallRatio(ErrorDetails.BUFFER_STALLED_ERROR)
    );
    // NOTE: Currently need to do some TS acrobatics here, as there's no obvious & clean way to extend
    // the modules/interfaces as they're currently defined in Hls.js
    const data: unknown = {
      details: LLFailoverEnum.LOW_LATENCY_FAILOVER_DETAIL,
      fatal: false,
      type: ErrorTypes.MEDIA_ERROR,
    };
    hls.trigger(Events.ERROR, data as ErrorData);
    this.destroy();
  }

  public destroy() {
    const { hls } = this;
    hls.off(Events.LEVEL_LOADED, this.onUnstalledEvent, this);
    hls.off(Events.FRAG_BUFFERED, this.onUnstalledEvent, this);
    hls.off(Events.ERROR, this.onError, this);
    hls.off(Events.LEVEL_LOADED, this.onLevelLoaded, this);
    hls.off(Events.ERROR, this.onError, this);
    hls.on(Events.DESTROYING, this.destroy, this);
    Object.entries(this.intervalHandle)
      .filter((x) => x)
      .forEach(([details, handle]) => {
        if (!handle) return;
        window.clearInterval(handle);
        this.intervalHandle[details] = undefined;
      });
  }
}
