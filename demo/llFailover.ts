type Stall = {
  type: string;
  details: string;
  currentLevel: number;
  startTimestamp: number;
  endTimestamp?: number;
};

const isLowLatencyStream = (levelDetails) =>
  levelDetails.live && !!levelDetails.partList;
const DEFAULT_TARGET_LL_FAILOVER_LEVEL = 0;
const DEFAULT_LL_FAILOVER_TIME_WINDOW = 60000;
const DEFAULT_LL_FAILOVER_STALL_COUNT = 5;
const DEFAULT_LL_FAILOVER_STALLED_RATIO = 0.05;

// @ts-ignore
const { Events, ErrorTypes, ErrorDetails } = Hls;

const finalizeLastStall = (stalls, detailType) => {
  const stall = stalls.reverse().find(({ details }) => details === detailType);
  stall.endTimestamp = Date.now();
  return stalls;
};

const relevantErrorTypes = [ErrorTypes.MEDIA_ERROR, ErrorTypes.NETWORK_ERROR];
const relevantErrorDetails = [
  ErrorDetails.BUFFER_STALLED_ERROR,
  ErrorDetails.LEVEL_LOAD_TIMEOUT,
];
const isRelevantError = ({ type, details }) =>
  relevantErrorTypes.includes(type) && relevantErrorDetails.includes(details);

const StallEventTypeMap = {
  [ErrorDetails.BUFFER_STALLED_ERROR]: Events.FRAG_BUFFERED,
  [ErrorDetails.LEVEL_LOAD_TIMEOUT]: Events.LEVEL_LOADED,
};

const getWindowStart = (
  llFailoverTimeWindow = DEFAULT_LL_FAILOVER_TIME_WINDOW
) => Date.now() - llFailoverTimeWindow;

const getStallRatio = (stalls, llFailoverTimeWindow) => {
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
  return stalls;
};

const pruneStallsByTimeWindow = (stalls, llFailoverTimeWindow) => {
  const windowStart = getWindowStart(llFailoverTimeWindow);
  return stalls.filter(({ endTimestamp }) => endTimestamp >= windowStart);
};

export const addLLFailoverMonitor = (hls) => {
  let targetLLFailoverLevel = -1;
  let llFailoverTimeWindow = Number.POSITIVE_INFINITY;
  let llFailoverStallCount = Number.POSITIVE_INFINITY;
  let llFailoverStallRatio = Number.POSITIVE_INFINITY;

  let stalls: Stall[] = [];
  const errorHandler = (_eventType, data) => {
    if (hls.currentLevel > targetLLFailoverLevel) return;
    if (!isRelevantError(data)) return;
    stalls = pruneStallsByTimeWindow(stalls, llFailoverTimeWindow);
    const { type, details } = data;
    stalls.push({
      type,
      details,
      currentLevel: hls.currentLevel,
      startTimestamp: Date.now(),
    });

    if (stalls.length >= llFailoverStallCount) {
      hls.lowLatencyMode = false;
      hls.off(Events.ERROR, errorHandler);
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
      stalls = finalizeLastStall(stalls, details);
      const stallRatio = getStallRatio(stalls, llFailoverTimeWindow);
      if (stallRatio >= llFailoverStallRatio) {
        hls.lowLatencyMode = false;
        hls.off(Events.ERROR, errorHandler);
        console.warn(
          'Cannot keep up with low latency mode. Attempting non-low latency playback!'
        );
      }
    });
    console.log('drift', hls.drift);
    console.log('latency', hls.latency);
  };

  const levelLoadedHandler = (_eventType, data) => {
    const { details } = data;
    if (!isLowLatencyStream(details)) return;
    // 3. Since we are both in lowLatencyMode and are playing a low latency stream, start monitoring
    // for failover conditions.
    targetLLFailoverLevel =
      hls.config.targetLLFailoverLevel ?? DEFAULT_TARGET_LL_FAILOVER_LEVEL;
    llFailoverTimeWindow =
      hls.config.llFailoverTimeWindow ?? DEFAULT_LL_FAILOVER_TIME_WINDOW;
    llFailoverStallCount =
      hls.config.llFailoverStallCount ?? DEFAULT_LL_FAILOVER_STALL_COUNT;
    llFailoverStallRatio =
      hls.config.llFailoverStallRatio ?? DEFAULT_LL_FAILOVER_STALLED_RATIO;
    hls.on(Events.ERROR, errorHandler);
  };

  // Before applying any logic, first determine:
  // 1. Are we configured for lowLatencyMode?
  if (hls.lowLatencyMode) {
    // 2. Wait until the first level is loaded to determine if we're playing a low latency stream
    hls.once(Events.LEVEL_LOADED, levelLoadedHandler);
  }
};
