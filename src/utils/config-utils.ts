import type { HlsConfig, LoaderConfig } from '../config';
import FetchLoader, { fetchSupported } from './fetch-loader';
import type { ILogger } from './logger';
import XhrLoader from './xhr-loader';

/**
 * @ignore
 */
export function mergeConfig(
  defaultConfig: Partial<HlsConfig>,
  userConfig: Partial<HlsConfig>,
  logger: ILogger,
): HlsConfig {
  if (
    (userConfig.liveSyncDurationCount ||
      userConfig.liveMaxLatencyDurationCount) &&
    (userConfig.liveSyncDuration || userConfig.liveMaxLatencyDuration)
  ) {
    throw new Error(
      "Illegal hls.js config: don't mix up liveSyncDurationCount/liveMaxLatencyDurationCount and liveSyncDuration/liveMaxLatencyDuration",
    );
  }

  if (
    userConfig.liveMaxLatencyDurationCount !== undefined &&
    (userConfig.liveSyncDurationCount === undefined ||
      userConfig.liveMaxLatencyDurationCount <=
        userConfig.liveSyncDurationCount)
  ) {
    throw new Error(
      'Illegal hls.js config: "liveMaxLatencyDurationCount" must be greater than "liveSyncDurationCount"',
    );
  }

  if (
    userConfig.liveMaxLatencyDuration !== undefined &&
    (userConfig.liveSyncDuration === undefined ||
      userConfig.liveMaxLatencyDuration <= userConfig.liveSyncDuration)
  ) {
    throw new Error(
      'Illegal hls.js config: "liveMaxLatencyDuration" must be greater than "liveSyncDuration"',
    );
  }

  const defaultsCopy = deepCpy(defaultConfig);

  // Backwards compatibility with deprecated config values
  const deprecatedSettingTypes = ['manifest', 'level', 'frag'];
  const deprecatedSettings = [
    'TimeOut',
    'MaxRetry',
    'RetryDelay',
    'MaxRetryTimeout',
  ];
  deprecatedSettingTypes.forEach((type) => {
    const policyName = `${type === 'level' ? 'playlist' : type}LoadPolicy`;
    const policyNotSet = userConfig[policyName] === undefined;
    const report: string[] = [];
    deprecatedSettings.forEach((setting) => {
      const deprecatedSetting = `${type}Loading${setting}`;
      const value = userConfig[deprecatedSetting];
      if (value !== undefined && policyNotSet) {
        report.push(deprecatedSetting);
        const settings: LoaderConfig = defaultsCopy[policyName].default;
        userConfig[policyName] = { default: settings };
        switch (setting) {
          case 'TimeOut':
            settings.maxLoadTimeMs = value;
            settings.maxTimeToFirstByteMs = value;
            break;
          case 'MaxRetry':
            settings.errorRetry!.maxNumRetry = value;
            settings.timeoutRetry!.maxNumRetry = value;
            break;
          case 'RetryDelay':
            settings.errorRetry!.retryDelayMs = value;
            settings.timeoutRetry!.retryDelayMs = value;
            break;
          case 'MaxRetryTimeout':
            settings.errorRetry!.maxRetryDelayMs = value;
            settings.timeoutRetry!.maxRetryDelayMs = value;
            break;
        }
      }
    });
    if (report.length) {
      logger.warn(
        `hls.js config: "${report.join(
          '", "',
        )}" setting(s) are deprecated, use "${policyName}": ${JSON.stringify(
          userConfig[policyName],
        )}`,
      );
    }
  });

  return {
    ...defaultsCopy,
    ...userConfig,
  };
}

function deepCpy(obj: any): any {
  if (obj && typeof obj === 'object') {
    if (Array.isArray(obj)) {
      return obj.map(deepCpy);
    }
    return Object.keys(obj).reduce((result, key) => {
      result[key] = deepCpy(obj[key]);
      return result;
    }, {});
  }
  return obj;
}

/**
 * @ignore
 */
export function enableStreamingMode(config: HlsConfig, logger: ILogger) {
  const currentLoader = config.loader;
  if (currentLoader !== FetchLoader && currentLoader !== XhrLoader) {
    // If a developer has configured their own loader, respect that choice
    logger.log(
      '[config]: Custom loader detected, cannot enable progressive streaming',
    );
    config.progressive = false;
  } else {
    const canStreamProgressively = fetchSupported();
    if (canStreamProgressively) {
      config.loader = FetchLoader;
      config.progressive = true;
      config.enableSoftwareAES = true;
      logger.log('[config]: Progressive streaming enabled, using FetchLoader');
    }
  }
}
