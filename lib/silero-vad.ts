/**
 * Silero VAD V5 via ExecuTorch — on-device neural speech detection.
 * Ported from Polyglot's silero-executorch.ts.
 *
 * Each frame is 576 PCM samples at 16kHz (36ms). Returns speech probability 0.0–1.0.
 * LSTM state carried forward between frames, reset between conversations.
 */

let ExecutorchModule: any = null;
let ScalarType: any = null;

let model: any = null;
let hState = new Float32Array(128);
let cState = new Float32Array(128);
let isLoaded = false;
let loadAttempted = false;
let inferenceInProgress = false;

/**
 * Load the Silero VAD .pte model. Safe to call multiple times.
 */
export async function loadSileroVAD(): Promise<boolean> {
  if (isLoaded) return true;
  if (loadAttempted) return false;
  loadAttempted = true;

  try {
    const etModule = await import('react-native-executorch');
    ExecutorchModule = etModule.ExecutorchModule;
    ScalarType = etModule.ScalarType;

    if (!ExecutorchModule || !ScalarType) {
      throw new Error('ExecutorchModule not found');
    }

    model = new ExecutorchModule();
    await model.load(require('../assets/models/silero_vad_v5.pte'));

    isLoaded = true;
    resetState();
    console.log('[SileroVAD] Model loaded successfully');
    return true;
  } catch (e: any) {
    console.warn('[SileroVAD] Not available:', e.message || e);
    model = null;
    return false;
  }
}

/**
 * Run inference on a single 576-sample audio frame.
 * @returns Speech probability 0.0–1.0, or -1 if not available
 */
export async function detectSpeech(audioFrame: Float32Array): Promise<number> {
  if (!model || !isLoaded) return -1;
  if (inferenceInProgress) return -1;

  inferenceInProgress = true;
  try {
    const outputs = await model.forward([
      { dataPtr: audioFrame, sizes: [1, 576], scalarType: ScalarType.FLOAT },
      { dataPtr: hState, sizes: [1, 1, 128], scalarType: ScalarType.FLOAT },
      { dataPtr: cState, sizes: [1, 1, 128], scalarType: ScalarType.FLOAT },
    ]);

    const prob = new Float32Array(outputs[0].dataPtr)[0];
    hState = new Float32Array(outputs[1].dataPtr);
    cState = new Float32Array(outputs[2].dataPtr);

    inferenceInProgress = false;
    return prob;
  } catch (e: any) {
    inferenceInProgress = false;
    return -1;
  }
}

/**
 * Reset LSTM states between conversations.
 */
export function resetState(): void {
  hState = new Float32Array(128);
  cState = new Float32Array(128);
}

/**
 * Unload model and free resources.
 */
export function unloadSilero(): void {
  if (model) {
    try { model.delete(); } catch {}
    model = null;
  }
  isLoaded = false;
  loadAttempted = false;
  resetState();
}

/**
 * Check if Silero is available (native module exists).
 */
export async function isSileroAvailable(): Promise<boolean> {
  try {
    await import('react-native-executorch');
    return true;
  } catch {
    return false;
  }
}
