/**
 * ポーズ人形（three.js）の公開 API。
 * このモジュール自体は three を静的 import しない。createMannequinView の中で `await import('three')` する。
 */
export { createMannequinView, hasWebGL2, SNAPSHOT_SIZE } from './view';
export type {
  CompareSnapshot,
  MannequinOptions,
  MannequinUnsupported,
  MannequinViewApi,
  MannequinViewResult,
  SilhouetteSnapshot,
  SnapshotSize,
  ViewState,
} from './view';
export { POSES, POSE_IDS, getPose, isPoseId, pickPoseSequence, resolvePose, type PoseDef, type PoseId } from './poses';
export { roundView, CAMERA_PRESETS, DEFAULT_LIGHT, type CameraPreset, type CameraState, type LightState, type RoundView } from './camera';
