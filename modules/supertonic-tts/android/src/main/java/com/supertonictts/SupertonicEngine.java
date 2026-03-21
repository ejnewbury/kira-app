package com.supertonictts;

import ai.onnxruntime.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.*;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.nio.LongBuffer;
import java.text.Normalizer;
import java.util.*;
import java.util.regex.Pattern;

/**
 * Supertonic 2 TTS Engine — adapted from supertone-inc/supertonic Java SDK.
 * 66M-parameter flow-matching TTS with 5 language support (EN, ES, FR, KO, PT).
 *
 * Pipeline: text → unicode tokens → duration prediction → text encoding
 *         → noise sampling → iterative denoising → vocoder → PCM float32
 */
public class SupertonicEngine {

    private static final String TAG = "SupertonicEngine";
    private static final List<String> AVAILABLE_LANGS = Arrays.asList("en", "ko", "es", "pt", "fr");
    private static final String[] ABBREVIATIONS = {
        "Dr.", "Mr.", "Mrs.", "Ms.", "Prof.", "Sr.", "Jr.",
        "St.", "Ave.", "Rd.", "Blvd.", "Dept.", "Inc.", "Ltd.",
        "Co.", "Corp.", "etc.", "vs.", "i.e.", "e.g.", "Ph.D."
    };

    // ONNX Runtime
    private OrtEnvironment env;
    private OrtSession dpSession;
    private OrtSession textEncSession;
    private OrtSession vectorEstSession;
    private OrtSession vocoderSession;

    // Config
    private int sampleRate;
    private int baseChunkSize;
    private int chunkCompress;
    private int latentDim;

    // Text processor
    private long[] unicodeIndexer;

    // Voice style tensors
    private OnnxTensor styleTtlTensor;
    private OnnxTensor styleDpTensor;

    // Synthesis params
    private int totalStep = 2;
    private float speed = 1.05f;

    private boolean initialized = false;

    /**
     * Initialize the engine with model directory and voice style.
     */
    public void initialize(String onnxDir, String voiceStylePath, int totalStep, float speed)
            throws Exception {
        this.totalStep = totalStep;
        this.speed = speed;

        // Create ONNX environment
        env = OrtEnvironment.getEnvironment();

        // Load config
        ObjectMapper mapper = new ObjectMapper();
        JsonNode configRoot = mapper.readTree(new File(onnxDir + "/tts.json"));
        sampleRate = configRoot.get("ae").get("sample_rate").asInt();
        baseChunkSize = configRoot.get("ae").get("base_chunk_size").asInt();
        chunkCompress = configRoot.get("ttl").get("chunk_compress_factor").asInt();
        latentDim = configRoot.get("ttl").get("latent_dim").asInt();

        // Load unicode indexer
        JsonNode indexerRoot = mapper.readTree(new File(onnxDir + "/unicode_indexer.json"));
        unicodeIndexer = new long[indexerRoot.size()];
        for (int i = 0; i < indexerRoot.size(); i++) {
            unicodeIndexer[i] = indexerRoot.get(i).asLong();
        }

        // Load ONNX sessions
        OrtSession.SessionOptions opts = new OrtSession.SessionOptions();
        dpSession = env.createSession(onnxDir + "/duration_predictor.onnx", opts);
        textEncSession = env.createSession(onnxDir + "/text_encoder.onnx", opts);
        vectorEstSession = env.createSession(onnxDir + "/vector_estimator.onnx", opts);
        vocoderSession = env.createSession(onnxDir + "/vocoder.onnx", opts);

        // Load voice style
        loadVoiceStyle(voiceStylePath);

        initialized = true;
        android.util.Log.i(TAG, "Initialized: sampleRate=" + sampleRate +
            " baseChunkSize=" + baseChunkSize + " chunkCompress=" + chunkCompress +
            " latentDim=" + latentDim + " totalStep=" + totalStep + " speed=" + speed);
    }

    private void loadVoiceStyle(String path) throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        JsonNode root = mapper.readTree(new File(path));

        // TTL style
        JsonNode ttlNode = root.get("style_ttl");
        long[] ttlDims = new long[3];
        for (int i = 0; i < 3; i++) ttlDims[i] = ttlNode.get("dims").get(i).asLong();

        int ttlSize = (int)(ttlDims[0] * ttlDims[1] * ttlDims[2]);
        float[] ttlFlat = new float[ttlSize];
        int idx = 0;
        for (JsonNode batch : ttlNode.get("data")) {
            for (JsonNode row : batch) {
                for (JsonNode val : row) {
                    ttlFlat[idx++] = (float) val.asDouble();
                }
            }
        }
        styleTtlTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(ttlFlat), ttlDims);

        // DP style
        JsonNode dpNode = root.get("style_dp");
        long[] dpDims = new long[3];
        for (int i = 0; i < 3; i++) dpDims[i] = dpNode.get("dims").get(i).asLong();

        int dpSize = (int)(dpDims[0] * dpDims[1] * dpDims[2]);
        float[] dpFlat = new float[dpSize];
        idx = 0;
        for (JsonNode batch : dpNode.get("data")) {
            for (JsonNode row : batch) {
                for (JsonNode val : row) {
                    dpFlat[idx++] = (float) val.asDouble();
                }
            }
        }
        styleDpTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(dpFlat), dpDims);
    }

    public int getSampleRate() { return sampleRate; }
    public boolean isInitialized() { return initialized; }

    /**
     * Synthesize text to PCM float32 audio with automatic chunking for long text.
     */
    public float[] synthesize(String text, String lang) throws Exception {
        if (!initialized) throw new IllegalStateException("Engine not initialized");
        if (!AVAILABLE_LANGS.contains(lang)) {
            throw new IllegalArgumentException("Invalid language: " + lang);
        }

        int maxLen = lang.equals("ko") ? 120 : 300;
        List<String> chunks = chunkText(text, maxLen);

        List<Float> wavCat = new ArrayList<>();
        for (int i = 0; i < chunks.size(); i++) {
            float[] chunkWav = inferSingle(chunks.get(i), lang);
            if (i > 0) {
                // Add 0.3s silence between chunks
                int silenceLen = (int)(0.3f * sampleRate);
                for (int j = 0; j < silenceLen; j++) wavCat.add(0.0f);
            }
            for (float v : chunkWav) wavCat.add(v);
        }

        float[] result = new float[wavCat.size()];
        for (int i = 0; i < result.length; i++) result[i] = wavCat.get(i);
        return result;
    }

    /**
     * Core inference for a single text chunk.
     */
    private float[] inferSingle(String text, String lang) throws OrtException {
        // Preprocess text
        String processed = preprocessText(text, lang);
        int[] codePoints = processed.codePoints().toArray();
        int seqLen = codePoints.length;

        // Convert to token IDs
        long[][] textIds = new long[1][seqLen];
        for (int j = 0; j < seqLen; j++) {
            textIds[0][j] = (codePoints[j] < unicodeIndexer.length) ? unicodeIndexer[codePoints[j]] : 0;
        }

        // Text mask
        float[][][] textMask = new float[1][1][seqLen];
        for (int j = 0; j < seqLen; j++) textMask[0][0][j] = 1.0f;

        // Create tensors
        OnnxTensor textIdsTensor = createLongTensor(textIds);
        OnnxTensor textMaskTensor = createFloatTensor3D(textMask);

        // 1. Duration prediction
        Map<String, OnnxTensor> dpInputs = new HashMap<>();
        dpInputs.put("text_ids", textIdsTensor);
        dpInputs.put("style_dp", styleDpTensor);
        dpInputs.put("text_mask", textMaskTensor);

        OrtSession.Result dpResult = dpSession.run(dpInputs);
        Object dpValue = dpResult.get(0).getValue();
        float duration;
        if (dpValue instanceof float[][]) {
            duration = ((float[][]) dpValue)[0][0];
        } else {
            duration = ((float[]) dpValue)[0];
        }
        duration /= speed;

        // 2. Text encoding
        Map<String, OnnxTensor> textEncInputs = new HashMap<>();
        textEncInputs.put("text_ids", textIdsTensor);
        textEncInputs.put("style_ttl", styleTtlTensor);
        textEncInputs.put("text_mask", textMaskTensor);

        OrtSession.Result textEncResult = textEncSession.run(textEncInputs);
        OnnxTensor textEmbTensor = (OnnxTensor) textEncResult.get(0);

        // 3. Sample noisy latent
        long wavLen = (long)(duration * sampleRate);
        int chunkSize = baseChunkSize * chunkCompress;
        int latentLen = (int)((wavLen + chunkSize - 1) / chunkSize);
        int latentDimVal = latentDim * chunkCompress;

        Random rng = new Random();
        float[][][] noisyLatent = new float[1][latentDimVal][latentLen];
        for (int d = 0; d < latentDimVal; d++) {
            for (int t = 0; t < latentLen; t++) {
                double u1 = Math.max(1e-10, rng.nextDouble());
                double u2 = rng.nextDouble();
                noisyLatent[0][d][t] = (float)(Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2));
            }
        }

        float[][][] latentMask = new float[1][1][latentLen];
        for (int t = 0; t < latentLen; t++) latentMask[0][0][t] = 1.0f;

        // 4. Denoising loop
        float[] totalStepArr = { (float) totalStep };
        OnnxTensor totalStepTensor = OnnxTensor.createTensor(env, totalStepArr);

        float[][][] xt = noisyLatent;
        for (int step = 0; step < totalStep; step++) {
            float[] currentStepArr = { (float) step };
            OnnxTensor currentStepTensor = OnnxTensor.createTensor(env, currentStepArr);
            OnnxTensor xtTensor = createFloatTensor3D(xt);
            OnnxTensor latentMaskTensor = createFloatTensor3D(latentMask);
            OnnxTensor textMask2 = createFloatTensor3D(textMask);

            Map<String, OnnxTensor> vecEstInputs = new HashMap<>();
            vecEstInputs.put("noisy_latent", xtTensor);
            vecEstInputs.put("text_emb", textEmbTensor);
            vecEstInputs.put("style_ttl", styleTtlTensor);
            vecEstInputs.put("latent_mask", latentMaskTensor);
            vecEstInputs.put("text_mask", textMask2);
            vecEstInputs.put("current_step", currentStepTensor);
            vecEstInputs.put("total_step", totalStepTensor);

            OrtSession.Result vecEstResult = vectorEstSession.run(vecEstInputs);
            float[][][] denoised = (float[][][]) vecEstResult.get(0).getValue();
            xt = denoised;

            currentStepTensor.close();
            xtTensor.close();
            latentMaskTensor.close();
            textMask2.close();
            vecEstResult.close();
        }

        // 5. Vocoder
        OnnxTensor finalLatentTensor = createFloatTensor3D(xt);
        Map<String, OnnxTensor> vocoderInputs = new HashMap<>();
        vocoderInputs.put("latent", finalLatentTensor);

        OrtSession.Result vocoderResult = vocoderSession.run(vocoderInputs);
        float[][] wavBatch = (float[][]) vocoderResult.get(0).getValue();

        // Trim to actual duration
        int actualLen = Math.min((int)(duration * sampleRate), wavBatch[0].length);
        float[] wav = new float[actualLen];
        System.arraycopy(wavBatch[0], 0, wav, 0, actualLen);

        // Cleanup non-reusable tensors
        textIdsTensor.close();
        textMaskTensor.close();
        dpResult.close();
        // Note: textEncResult not closed — textEmbTensor may be used across steps
        totalStepTensor.close();
        finalLatentTensor.close();
        vocoderResult.close();

        return wav;
    }

    /**
     * Write PCM float32 audio to WAV file.
     */
    public void writeWavFile(String filename, float[] audioData) throws IOException {
        int dataSize = audioData.length * 2;
        byte[] header = new byte[44];
        ByteBuffer bb = ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN);

        // RIFF header
        bb.put("RIFF".getBytes());
        bb.putInt(36 + dataSize);
        bb.put("WAVE".getBytes());

        // fmt chunk
        bb.put("fmt ".getBytes());
        bb.putInt(16);           // chunk size
        bb.putShort((short) 1);  // PCM
        bb.putShort((short) 1);  // mono
        bb.putInt(sampleRate);
        bb.putInt(sampleRate * 2); // byte rate
        bb.putShort((short) 2);  // block align
        bb.putShort((short) 16); // bits per sample

        // data chunk
        bb.put("data".getBytes());
        bb.putInt(dataSize);

        FileOutputStream fos = new FileOutputStream(filename);
        fos.write(header);

        ByteBuffer samples = ByteBuffer.allocate(dataSize).order(ByteOrder.LITTLE_ENDIAN);
        for (float sample : audioData) {
            short val = (short) Math.max(-32768, Math.min(32767, sample * 32767));
            samples.putShort(val);
        }
        fos.write(samples.array());
        fos.close();
    }

    /**
     * Release all resources.
     */
    public void deinitialize() {
        initialized = false;
        try { if (dpSession != null) dpSession.close(); } catch (Exception e) {}
        try { if (textEncSession != null) textEncSession.close(); } catch (Exception e) {}
        try { if (vectorEstSession != null) vectorEstSession.close(); } catch (Exception e) {}
        try { if (vocoderSession != null) vocoderSession.close(); } catch (Exception e) {}
        try { if (styleTtlTensor != null) styleTtlTensor.close(); } catch (Exception e) {}
        try { if (styleDpTensor != null) styleDpTensor.close(); } catch (Exception e) {}
        dpSession = null;
        textEncSession = null;
        vectorEstSession = null;
        vocoderSession = null;
        styleTtlTensor = null;
        styleDpTensor = null;
        android.util.Log.i(TAG, "Deinitialized");
    }

    // =========================================================================
    // Text Processing
    // =========================================================================

    private String preprocessText(String text, String lang) {
        text = Normalizer.normalize(text, Normalizer.Form.NFKD);
        text = removeEmojis(text);

        Map<String, String> replacements = new HashMap<>();
        replacements.put("\u2013", "-"); replacements.put("\u2011", "-");
        replacements.put("\u2014", "-"); replacements.put("_", " ");
        replacements.put("\u201C", "\""); replacements.put("\u201D", "\"");
        replacements.put("\u2018", "'"); replacements.put("\u2019", "'");
        replacements.put("\u00B4", "'"); replacements.put("`", "'");
        replacements.put("[", " "); replacements.put("]", " ");
        replacements.put("|", " "); replacements.put("/", " ");
        replacements.put("#", " "); replacements.put("\u2192", " ");
        replacements.put("\u2190", " ");
        for (Map.Entry<String, String> e : replacements.entrySet()) {
            text = text.replace(e.getKey(), e.getValue());
        }

        text = text.replaceAll("[\\u2665\\u2606\\u2661\\u00A9\\\\]", "");
        text = text.replace("@", " at ");
        text = text.replace("e.g.,", "for example, ");
        text = text.replace("i.e.,", "that is, ");
        text = text.replaceAll(" ,", ",").replaceAll(" \\.", ".")
                   .replaceAll(" !", "!").replaceAll(" \\?", "?")
                   .replaceAll(" ;", ";").replaceAll(" :", ":")
                   .replaceAll(" '", "'");
        while (text.contains("\"\"")) text = text.replace("\"\"", "\"");
        while (text.contains("''")) text = text.replace("''", "'");
        text = text.replaceAll("\\s+", " ").trim();

        if (!text.isEmpty() && !text.matches(".*[.!?;:,'\"]$")) {
            text += ".";
        }

        return "<" + lang + ">" + text + "</" + lang + ">";
    }

    private static String removeEmojis(String text) {
        StringBuilder result = new StringBuilder();
        for (int i = 0; i < text.length(); ) {
            int cp = Character.codePointAt(text, i);
            boolean isEmoji = (cp >= 0x1F600 && cp <= 0x1F64F) ||
                (cp >= 0x1F300 && cp <= 0x1F5FF) || (cp >= 0x1F680 && cp <= 0x1F6FF) ||
                (cp >= 0x1F700 && cp <= 0x1FAFF) || (cp >= 0x2600 && cp <= 0x27BF) ||
                (cp >= 0x1F1E6 && cp <= 0x1F1FF);
            if (!isEmoji) result.appendCodePoint(cp);
            i += Character.charCount(cp);
        }
        return result.toString();
    }

    // =========================================================================
    // Text Chunking
    // =========================================================================

    private List<String> chunkText(String text, int maxLen) {
        text = text.trim();
        if (text.isEmpty()) return Arrays.asList("");
        if (text.length() <= maxLen) return Arrays.asList(text);

        // Split by sentence boundaries
        List<String> sentences = splitSentences(text);
        List<String> chunks = new ArrayList<>();
        StringBuilder current = new StringBuilder();

        for (String sentence : sentences) {
            sentence = sentence.trim();
            if (sentence.isEmpty()) continue;

            if (current.length() + sentence.length() + 1 > maxLen && current.length() > 0) {
                chunks.add(current.toString().trim());
                current.setLength(0);
            }

            if (sentence.length() > maxLen) {
                if (current.length() > 0) {
                    chunks.add(current.toString().trim());
                    current.setLength(0);
                }
                // Split long sentence by comma or space
                String[] words = sentence.split("\\s+");
                for (String word : words) {
                    if (current.length() + word.length() + 1 > maxLen && current.length() > 0) {
                        chunks.add(current.toString().trim());
                        current.setLength(0);
                    }
                    if (current.length() > 0) current.append(" ");
                    current.append(word);
                }
            } else {
                if (current.length() > 0) current.append(" ");
                current.append(sentence);
            }
        }
        if (current.length() > 0) chunks.add(current.toString().trim());
        return chunks.isEmpty() ? Arrays.asList("") : chunks;
    }

    private List<String> splitSentences(String text) {
        // Simple sentence split avoiding abbreviations
        Pattern pattern = Pattern.compile("(?<=[.!?])\\s+");
        String[] parts = pattern.split(text);
        return Arrays.asList(parts);
    }

    // =========================================================================
    // Tensor Helpers
    // =========================================================================

    private OnnxTensor createLongTensor(long[][] array) throws OrtException {
        int d0 = array.length, d1 = array[0].length;
        long[] flat = new long[d0 * d1];
        int idx = 0;
        for (long[] row : array) for (long v : row) flat[idx++] = v;
        return OnnxTensor.createTensor(env, LongBuffer.wrap(flat), new long[]{d0, d1});
    }

    private OnnxTensor createFloatTensor3D(float[][][] array) throws OrtException {
        int d0 = array.length, d1 = array[0].length, d2 = array[0][0].length;
        float[] flat = new float[d0 * d1 * d2];
        int idx = 0;
        for (float[][] batch : array) for (float[] row : batch) for (float v : row) flat[idx++] = v;
        return OnnxTensor.createTensor(env, FloatBuffer.wrap(flat), new long[]{d0, d1, d2});
    }
}
