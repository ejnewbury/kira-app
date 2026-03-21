package com.supertonictts;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.io.File;
import java.util.UUID;

/**
 * React Native native module for Supertonic 2 TTS.
 * Bridges SupertonicEngine to JavaScript.
 */
public class SupertonicTTSModule extends ReactContextBaseJavaModule {

    private static final String TAG = "SupertonicTTS";
    private static final String MODULE_NAME = "SupertonicTTS";

    private final ReactApplicationContext reactContext;
    private SupertonicEngine engine;
    private AudioTrack audioTrack;
    private Thread playbackThread;
    private volatile boolean isPlaying = false;

    public SupertonicTTSModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        this.engine = new SupertonicEngine();
    }

    @NonNull
    @Override
    public String getName() {
        return MODULE_NAME;
    }

    @ReactMethod
    public void initialize(String onnxDir, String voiceStylePath, int totalStep, double speed, Promise promise) {
        new Thread(() -> {
            try {
                long start = System.currentTimeMillis();
                engine.initialize(onnxDir, voiceStylePath, totalStep, (float) speed);
                long elapsed = System.currentTimeMillis() - start;
                Log.i(TAG, "Initialized in " + elapsed + "ms");
                promise.resolve(null);
            } catch (Exception e) {
                Log.e(TAG, "Initialize failed: " + e.getMessage(), e);
                promise.reject("INIT_ERROR", e.getMessage(), e);
            }
        }).start();
    }

    @ReactMethod
    public void generateAndPlay(String text, String language, Promise promise) {
        if (!engine.isInitialized()) {
            promise.reject("NOT_INITIALIZED", "TTS engine not initialized");
            return;
        }

        // Stop any current playback
        stopPlayback();

        new Thread(() -> {
            try {
                long synthStart = System.currentTimeMillis();
                float[] wav = engine.synthesize(text, language);
                long synthMs = System.currentTimeMillis() - synthStart;
                Log.i(TAG, "Synthesized " + wav.length + " samples in " + synthMs + "ms");

                // Play via AudioTrack
                playAudio(wav, engine.getSampleRate());
                promise.resolve(null);
            } catch (Exception e) {
                Log.e(TAG, "generateAndPlay failed: " + e.getMessage(), e);
                promise.reject("SYNTH_ERROR", e.getMessage(), e);
            }
        }).start();
    }

    @ReactMethod
    public void generateToFile(String text, String language, Promise promise) {
        if (!engine.isInitialized()) {
            promise.reject("NOT_INITIALIZED", "TTS engine not initialized");
            return;
        }

        new Thread(() -> {
            try {
                float[] wav = engine.synthesize(text, language);

                // Write to temp file
                File cacheDir = reactContext.getCacheDir();
                String filename = "supertonic_tts_" + UUID.randomUUID().toString() + ".wav";
                String filepath = new File(cacheDir, filename).getAbsolutePath();
                engine.writeWavFile(filepath, wav);

                Log.i(TAG, "Generated WAV: " + filepath + " (" + wav.length + " samples)");
                promise.resolve(filepath);
            } catch (Exception e) {
                Log.e(TAG, "generateToFile failed: " + e.getMessage(), e);
                promise.reject("SYNTH_ERROR", e.getMessage(), e);
            }
        }).start();
    }

    @ReactMethod
    public void stop() {
        stopPlayback();
    }

    @ReactMethod
    public void deinitialize() {
        stopPlayback();
        engine.deinitialize();
    }

    @ReactMethod
    public void getSampleRate(Promise promise) {
        if (!engine.isInitialized()) {
            promise.reject("NOT_INITIALIZED", "Engine not initialized");
            return;
        }
        promise.resolve(engine.getSampleRate());
    }

    // Required for NativeEventEmitter
    @ReactMethod
    public void addListener(String eventName) {}

    @ReactMethod
    public void removeListeners(int count) {}

    private void playAudio(float[] wav, int sampleRate) {
        isPlaying = true;

        // Convert float32 to int16
        short[] pcm = new short[wav.length];
        for (int i = 0; i < wav.length; i++) {
            pcm[i] = (short) Math.max(-32768, Math.min(32767, wav[i] * 32767));
        }

        int bufferSize = AudioTrack.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        );

        audioTrack = new AudioTrack.Builder()
            .setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build())
            .setAudioFormat(new AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(sampleRate)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build())
            .setBufferSizeInBytes(Math.max(bufferSize, pcm.length * 2))
            .setTransferMode(AudioTrack.MODE_STATIC)
            .build();

        audioTrack.write(pcm, 0, pcm.length);
        audioTrack.setNotificationMarkerPosition(pcm.length);
        audioTrack.setPlaybackPositionUpdateListener(new AudioTrack.OnPlaybackPositionUpdateListener() {
            @Override
            public void onMarkerReached(AudioTrack track) {
                isPlaying = false;
                sendEvent("SupertonicTTSComplete", null);
            }

            @Override
            public void onPeriodicNotification(AudioTrack track) {}
        });

        audioTrack.play();
    }

    private void stopPlayback() {
        isPlaying = false;
        if (audioTrack != null) {
            try {
                audioTrack.stop();
                audioTrack.release();
            } catch (Exception e) {
                Log.w(TAG, "Stop playback error: " + e.getMessage());
            }
            audioTrack = null;
        }
    }

    private void sendEvent(String eventName, @Nullable WritableMap params) {
        try {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                .emit(eventName, params);
        } catch (Exception e) {
            Log.w(TAG, "sendEvent failed: " + e.getMessage());
        }
    }
}
