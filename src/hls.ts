import { hlsDefaultConfig } from './config';
import { Events } from './events';
import { ErrorTypes, ErrorDetails } from './errors';
import type { HdcpLevel, Level } from './types/level';
import type { HlsEventEmitter, HlsListeners } from './events';
import type AudioTrackController from './controller/audio-track-controller';
import type AbrController from './controller/abr-controller';
import type BufferController from './controller/buffer-controller';
import type CapLevelController from './controller/cap-level-controller';
import type CMCDController from './controller/cmcd-controller';
import type EMEController from './controller/eme-controller';
import type SubtitleTrackController from './controller/subtitle-track-controller';
import type {
  AudioSelectionOption,
  MediaPlaylist,
  SubtitleSelectionOption,
  VideoSelectionOption,
} from './types/media-playlist';
import type { HlsConfig } from './config';
import type { BufferInfo } from './utils/buffer-helper';
import type AudioStreamController from './controller/audio-stream-controller';
import type BasePlaylistController from './controller/base-playlist-controller';
import type BaseStreamController from './controller/base-stream-controller';
import type ContentSteeringController from './controller/content-steering-controller';
import type ErrorController from './controller/error-controller';
import type FPSController from './controller/fps-controller';
import HlsBase from './hlsbase';

/**
 * The `Hls` class is the core of the HLS.js library used to instantiate player instances.
 * @public
 */
export default class Hls extends HlsBase implements HlsEventEmitter {
  /**
   * Get the default configuration applied to new instances.
   */
  static get DefaultConfig(): HlsConfig {
    return HlsBase.defaultConfig as HlsConfig;
  }

  /**
   * Replace the default configuration applied to new instances.
   */
  static set DefaultConfig(defaultConfig: HlsConfig | undefined) {
    if (!defaultConfig) {
      defaultConfig = hlsDefaultConfig;
    }
    HlsBase.defaultConfig = defaultConfig;
  }

  /**
   * Creates an instance of an HLS client that can attach to exactly one `HTMLMediaElement`.
   * @param userConfig - Configuration options applied over `Hls.DefaultConfig`
   */
  constructor(userConfig: Partial<HlsConfig> = {}) {
    super(userConfig);
    HlsBase.defaultConfig = hlsDefaultConfig;
  }
}

export type {
  AudioSelectionOption,
  SubtitleSelectionOption,
  VideoSelectionOption,
  MediaPlaylist,
  ErrorDetails,
  ErrorTypes,
  Events,
  Level,
  HlsListeners,
  HlsEventEmitter,
  HlsConfig,
  BufferInfo,
  HdcpLevel,
  AbrController,
  AudioStreamController,
  AudioTrackController,
  BasePlaylistController,
  BaseStreamController,
  BufferController,
  CapLevelController,
  CMCDController,
  ContentSteeringController,
  EMEController,
  ErrorController,
  FPSController,
  SubtitleTrackController,
};
export type {
  ComponentAPI,
  AbrComponentAPI,
  NetworkComponentAPI,
} from './types/component-api';
export type {
  ABRControllerConfig,
  BufferControllerConfig,
  CapLevelControllerConfig,
  CMCDControllerConfig,
  EMEControllerConfig,
  DRMSystemsConfiguration,
  DRMSystemOptions,
  FPSControllerConfig,
  FragmentLoaderConfig,
  FragmentLoaderConstructor,
  HlsLoadPolicies,
  LevelControllerConfig,
  LoaderConfig,
  LoadPolicy,
  MP4RemuxerConfig,
  PlaylistLoaderConfig,
  PlaylistLoaderConstructor,
  RetryConfig,
  SelectionPreferences,
  StreamControllerConfig,
  LatencyControllerConfig,
  MetadataControllerConfig,
  TimelineControllerConfig,
  TSDemuxerConfig,
} from './config';
export type { MediaKeySessionContext } from './controller/eme-controller';
export type { ILogger, Logger } from './utils/logger';
export type {
  PathwayClone,
  SteeringManifest,
  UriReplacement,
} from './controller/content-steering-controller';
export type { SubtitleStreamController } from './controller/subtitle-stream-controller';
export type { TimelineController } from './controller/timeline-controller';
export type { CuesInterface } from './utils/cues';
export type {
  MediaKeyFunc,
  KeySystems,
  KeySystemFormats,
} from './utils/mediakeys-helper';
export type { DateRange } from './loader/date-range';
export type { LoadStats } from './loader/load-stats';
export type { LevelKey } from './loader/level-key';
export type { LevelDetails } from './loader/level-details';
export type { SourceBufferName } from './types/buffer';
export type {
  MetadataSample,
  MetadataSchema,
  UserdataSample,
} from './types/demuxer';
export type {
  HlsSkip,
  HlsUrlParameters,
  LevelAttributes,
  LevelParsed,
  VariableMap,
} from './types/level';
export type { MediaDecodingInfo } from './utils/mediacapabilities-helper';
export type {
  PlaylistLevelType,
  HlsChunkPerformanceTiming,
  HlsPerformanceTiming,
  HlsProgressivePerformanceTiming,
  PlaylistContextType,
  PlaylistLoaderContext,
  FragmentLoaderContext,
  Loader,
  LoaderStats,
  LoaderContext,
  LoaderResponse,
  LoaderConfiguration,
  LoaderCallbacks,
  LoaderOnProgress,
  LoaderOnAbort,
  LoaderOnError,
  LoaderOnSuccess,
  LoaderOnTimeout,
} from './types/loader';
export type {
  MediaAttributes,
  MediaPlaylistType,
  MainPlaylistType,
  AudioPlaylistType,
  SubtitlePlaylistType,
} from './types/media-playlist';
export type { Track, TrackSet } from './types/track';
export type { ChunkMetadata } from './types/transmuxer';
export type {
  BaseSegment,
  Fragment,
  Part,
  ElementaryStreams,
  ElementaryStreamTypes,
  ElementaryStreamInfo,
} from './loader/fragment';
export type {
  TrackLoadingData,
  TrackLoadedData,
  AudioTrackLoadedData,
  AudioTracksUpdatedData,
  AudioTrackSwitchedData,
  AudioTrackSwitchingData,
  BackBufferData,
  BufferAppendedData,
  BufferAppendingData,
  BufferCodecsData,
  BufferCreatedData,
  BufferEOSData,
  BufferFlushedData,
  BufferFlushingData,
  CuesParsedData,
  ErrorData,
  FPSDropData,
  FPSDropLevelCappingData,
  FragBufferedData,
  FragChangedData,
  FragDecryptedData,
  FragLoadedData,
  FragLoadEmergencyAbortedData,
  FragLoadingData,
  FragParsedData,
  FragParsingInitSegmentData,
  FragParsingMetadataData,
  FragParsingUserdataData,
  InitPTSFoundData,
  KeyLoadedData,
  KeyLoadingData,
  LevelLoadedData,
  LevelLoadingData,
  LevelPTSUpdatedData,
  LevelsUpdatedData,
  LevelSwitchedData,
  LevelSwitchingData,
  LevelUpdatedData,
  LiveBackBufferData,
  ContentSteeringOptions,
  ManifestLoadedData,
  ManifestLoadingData,
  ManifestParsedData,
  MediaAttachedData,
  MediaAttachingData,
  MediaEndedData,
  NonNativeTextTrack,
  NonNativeTextTracksData,
  SteeringManifestLoadedData,
  SubtitleFragProcessedData,
  SubtitleTrackLoadedData,
  SubtitleTracksUpdatedData,
  SubtitleTrackSwitchData,
} from './types/events';
export type {
  NetworkErrorAction,
  ErrorActionFlags,
  IErrorAction,
} from './controller/error-controller';
export type { AttrList } from './utils/attr-list';
