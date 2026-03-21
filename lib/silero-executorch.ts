/**
 * Silero VAD V5 via ExecuTorch — on-device neural speech detection for native.
 *
 * Loads a pre-exported .pte model and runs frame-by-frame inference.
 * Each frame is 576 PCM samples at 16kHz (36ms). Returns speech probability 0.0–1.0.
 *
 * LSTM hidden state (h, c) is carried forward between frames and must be
 * reset between conversations via resetSileroState().
 *
 * Falls back gracefully if react-native-executorch isn't available (Expo Go).
 */

import log from './logger';

// Lazy imports — react-native-executorch is a native module, unavailable in Expo Go
let ExecutorchModule: any = null;
let ScalarType: any = null;

let model: any = null;
let hState = new Float32Array(128); // [1, 1, 128] flattened — LSTM hidden
let cState = new Float32Array(128); // [1, 1, 128] flattened — LSTM cell
let isLoaded = false;
let loadAttempted = false;
let inferenceInProgress = false; // Mutex — ExecuTorch can't handle concurrent forward() calls

/**
 * Load the Silero VAD .pte model. Safe to call multiple times (no-ops after first load).
 * Returns false if the model or native module isn't available.
 */
export async function loadSileroExecuTorch(): Promise<boolean> {
  if (isLoaded) return true;
  if (loadAttempted) return false; // Don't retry after a failed load
  loadAttempted = true;

  try {
    // Dynamic import — fails gracefully in Expo Go
    const etModule = await import('react-native-executorch');
    ExecutorchModule = etModule.ExecutorchModule;
    ScalarType = etModule.ScalarType;

    if (!ExecutorchModule || !ScalarType) {
      throw new Error('ExecutorchModule or ScalarType not found in module');
    }

    model = new ExecutorchModule();

    // Load bundled .pte model from assets
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    await model.load(require('../../assets/models/silero_vad_v5.pte'));

    isLoaded = true;
    resetSileroState();
    (globalThis as any).__sileroDebugLogged = false;
    (globalThis as any).__sileroErrorCount = 0;
    (globalThis as any).__sileroSuccessCount = 0;
    (globalThis as any).__sileroSkipCount = 0;

    // Debug: query model's expected input shapes
    try {
      const shape0 = await model.getInputShape('forward', 0);
      const shape1 = await model.getInputShape('forward', 1);
      const shape2 = await model.getInputShape('forward', 2);
      log.info('SileroET', `Model input shapes: [${shape0}], [${shape1}], [${shape2}]`);
    } catch (shapeErr: any) {
      log.warn('SileroET', `Could not query input shapes: ${shapeErr.message || shapeErr}`);
    }

    log.warn('SileroET', 'Silero VAD .pte loaded successfully'); // TODO: revert to log.info after preview test
    return true;
  } catch (e: any) {
    log.warn('SileroET', `Silero VAD not available: ${e.message || e}`);
    model = null;
    return false;
  }
}

/**
 * Run inference on a single audio frame.
 *
 * @param audioFrame Float32Array of 576 samples (normalized to [-1, 1])
 * @returns Speech probability 0.0–1.0, or -1 if model not loaded
 */
export async function detectSpeechProb(audioFrame: Float32Array): Promise<number> {
  if (!model || !isLoaded) return -1;
  if (inferenceInProgress) {
    if (!(globalThis as any).__sileroSkipCount) (globalThis as any).__sileroSkipCount = 0;
    (globalThis as any).__sileroSkipCount++;
    return -1;
  }

  inferenceInProgress = true;
  try {
    // Debug first call only
    if (!((globalThis as any).__sileroDebugLogged)) {
      (globalThis as any).__sileroDebugLogged = true;
      log.info('SileroET', `forward() input debug:`);
      log.info('SileroET', `  audioFrame: type=${audioFrame.constructor.name}, length=${audioFrame.length}, first3=[${audioFrame[0]?.toFixed(4)}, ${audioFrame[1]?.toFixed(4)}, ${audioFrame[2]?.toFixed(4)}]`);
      log.info('SileroET', `  hState: type=${hState.constructor.name}, length=${hState.length}`);
      log.info('SileroET', `  cState: type=${cState.constructor.name}, length=${cState.length}`);
      log.info('SileroET', `  ScalarType.FLOAT=${ScalarType.FLOAT}`);
    }

    const outputs = await model.forward([
      { dataPtr: audioFrame, sizes: [1, 576], scalarType: ScalarType.FLOAT },
      { dataPtr: hState, sizes: [1, 1, 128], scalarType: ScalarType.FLOAT },
      { dataPtr: cState, sizes: [1, 1, 128], scalarType: ScalarType.FLOAT },
    ]);

    // Read outputs — prob is scalar, h/c are LSTM states to carry forward
    const prob = new Float32Array(outputs[0].dataPtr)[0];
    hState = new Float32Array(outputs[1].dataPtr);
    cState = new Float32Array(outputs[2].dataPtr);

    inferenceInProgress = false;
    if (!(globalThis as any).__sileroSuccessCount) (globalThis as any).__sileroSuccessCount = 0;
    (globalThis as any).__sileroSuccessCount++;
    // Log stats every 50 successes
    if ((globalThis as any).__sileroSuccessCount % 50 === 1) {
      log.info('SileroET', `Stats: ${(globalThis as any).__sileroSuccessCount} ok, ${(globalThis as any).__sileroErrorCount || 0} err, ${(globalThis as any).__sileroSkipCount || 0} skip | prob=${prob.toFixed(3)}`);
    }
    return prob;
  } catch (e: any) {
    inferenceInProgress = false;
    // Throttle error logging to avoid spam
    if (!(globalThis as any).__sileroErrorCount) (globalThis as any).__sileroErrorCount = 0;
    (globalThis as any).__sileroErrorCount++;
    if ((globalThis as any).__sileroErrorCount <= 3 || (globalThis as any).__sileroErrorCount % 100 === 0) {
      log.warn('SileroET', `Inference error (#${(globalThis as any).__sileroErrorCount}): ${e.message || e}`);
    }
    return -1;
  }
}

/**
 * Reset LSTM hidden states. Call between conversations / when restarting VAD.
 */
export function resetSileroState(): void {
  hState = new Float32Array(128);
  cState = new Float32Array(128);
}

/**
 * Fully unload the model and free resources.
 */
export function unloadSilero(): void {
  if (model) {
    try {
      model.delete();
    } catch {}
    model = null;
  }
  isLoaded = false;
  loadAttempted = false;
  resetSileroState();
}
