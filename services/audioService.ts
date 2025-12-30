
// Audio Constants
export const SAMPLE_RATE = 44100;
export const FFT_SIZE = 2048;
export const HOP_SIZE = 256; 

let audioContext: AudioContext | null = null;

export const getAudioContext = (): AudioContext => {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: SAMPLE_RATE });
  }
  return audioContext;
};

// --- Preset Definitions ---

export interface EncodePreset {
    id: string;
    name: string;
    carrierBaseFreq: number;
    pitchMultiplier: number;
    inputLpfCutoff: number;
    description: string;
}

export interface DecodePreset {
    id: string;
    name: string;
    lpfCutoff: number;
    filterStages: number;
    gainMultiplier: number;
    description: string;
}

export const ENCODE_PRESETS: EncodePreset[] = [
    {
        id: 'turdus',
        name: 'TURDUS (STD)',
        carrierBaseFreq: 4000,
        pitchMultiplier: 16.0,
        inputLpfCutoff: 2500,
        description: 'Standard Blackbird modulation.'
    },
    {
        id: 'erithacus',
        name: 'ERITHACUS (HI)',
        carrierBaseFreq: 5500,
        pitchMultiplier: 20.0,
        inputLpfCutoff: 3000,
        description: 'High-pitch Robin variant. Clearer speech.'
    },
    {
        id: 'strix',
        name: 'STRIX (LO)',
        carrierBaseFreq: 2000,
        pitchMultiplier: 8.0,
        inputLpfCutoff: 1200,
        description: 'Low-freq Owl rumble. High concealment.'
    }
];

export const DECODE_PRESETS: DecodePreset[] = [
    {
        id: 'std',
        name: 'STANDARD',
        lpfCutoff: 2500,
        filterStages: 3,
        gainMultiplier: 8.0,
        description: 'Balanced recovery.'
    },
    {
        id: 'wide',
        name: 'CLARITY (WIDE)',
        lpfCutoff: 3500,
        filterStages: 2,
        gainMultiplier: 6.0,
        description: 'More treble, some carrier bleed.'
    },
    {
        id: 'narrow',
        name: 'ISOLATION (NR)',
        lpfCutoff: 1500,
        filterStages: 4,
        gainMultiplier: 12.0,
        description: 'Aggressive filtering for noisy artifacts.'
    }
];

// --- DSP Utilities ---

// 2nd Order Butterworth Low Pass Filter (Sample-by-sample)
class LowPassFilter {
  private a0: number; private a1: number; private a2: number;
  private b1: number; private b2: number;
  private x1 = 0; private x2 = 0;
  private y1 = 0; private y2 = 0;

  constructor(cutoff: number, sampleRate: number) {
    const omega = 2 * Math.PI * cutoff / sampleRate;
    const sn = Math.sin(omega);
    const cs = Math.cos(omega);
    const alpha = sn / (2 * Math.SQRT2);

    const b0 = (1 - cs) / 2;
    this.a0 = b0;
    this.a1 = 1 - cs;
    this.a2 = b0;
    
    const a0_div = 1 + alpha;
    this.b1 = -2 * cs;
    this.b2 = 1 - alpha;

    // Normalize
    this.a0 /= a0_div;
    this.a1 /= a0_div;
    this.a2 /= a0_div;
    this.b1 /= a0_div;
    this.b2 /= a0_div;
  }

  process(sample: number): number {
    const y = this.a0 * sample + this.a1 * this.x1 + this.a2 * this.x2 
              - this.b1 * this.y1 - this.b2 * this.y2;
    this.x2 = this.x1;
    this.x1 = sample;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

// Simple DC Blocker (High Pass)
class DCBlocker {
  private x1 = 0;
  private y1 = 0;
  private r = 0.995;

  process(sample: number): number {
    const y = sample - this.x1 + this.r * this.y1;
    this.x1 = sample;
    this.y1 = y;
    return y;
  }
}

const extractPitch = (buffer: Float32Array, sampleRate: number): number => {
  // YIN-like autocorrelation simplification
  const minPeriod = Math.floor(sampleRate / 400); // Max 400Hz
  const maxPeriod = Math.floor(sampleRate / 70);  // Min 70Hz
  
  let bestCorrelation = -1;
  let bestPeriod = 0;

  // Root Mean Square for gating
  let rms = 0;
  for(let i=0; i<buffer.length; i++) rms += buffer[i]*buffer[i];
  rms = Math.sqrt(rms / buffer.length);
  
  if (rms < 0.02) return 0; // Silence gate

  // Autocorrelation
  for (let period = minPeriod; period < maxPeriod; period++) {
    let sum = 0;
    // Inspect center of buffer
    for (let i = 0; i < buffer.length - period; i+=2) { 
      sum += buffer[i] * buffer[i + period];
    }
    
    if (sum > bestCorrelation) {
      bestCorrelation = sum;
      bestPeriod = period;
    }
  }

  // Refinement could happen here, but integer period is okay for carrier driving
  return bestPeriod > 0 ? sampleRate / bestPeriod : 0;
};

// --- Codec Implementation ---

export const encodeToBirdsong = async (inputBuffer: AudioBuffer, preset: EncodePreset = ENCODE_PRESETS[0]): Promise<AudioBuffer> => {
  const ctx = getAudioContext();
  const numChannels = inputBuffer.numberOfChannels;
  const totalLength = inputBuffer.length;
  
  // 1. Prepare Pitch Analysis (Mono Mix)
  let pitchInputData: Float32Array;
  
  if (numChannels === 1) {
      pitchInputData = inputBuffer.getChannelData(0);
  } else {
      // Downmix for pitch detection
      pitchInputData = new Float32Array(totalLength);
      const channelsData = [];
      for(let c=0; c<numChannels; c++) channelsData.push(inputBuffer.getChannelData(c));
      
      for(let i=0; i<totalLength; i++) {
          let sum = 0;
          for(let c=0; c<numChannels; c++) sum += channelsData[c][i];
          pitchInputData[i] = sum / numChannels;
      }
  }
  
  // Analyze in chunks to drive the carrier frequency
  const pitchAnalysisStep = 512;
  const numFrames = Math.ceil(totalLength / pitchAnalysisStep);
  const pitchCurve = new Float32Array(totalLength);
  
  let lastPitch = 120; // Default human pitch start

  for (let i = 0; i < numFrames; i++) {
    const start = i * pitchAnalysisStep;
    const end = Math.min(start + FFT_SIZE, totalLength);
    if (end - start < FFT_SIZE/2) break;
    
    const slice = pitchInputData.slice(start, end);
    let pitch = extractPitch(slice, SAMPLE_RATE);
    
    // Smooth pitch or hold last pitch to prevent carrier dropouts during unvoiced speech
    if (pitch === 0) {
      pitch = lastPitch; 
    } else {
      // Smoothing
      pitch = lastPitch * 0.8 + pitch * 0.2;
      lastPitch = pitch;
    }
    
    // Fill the sample-accurate pitch curve
    for (let j = 0; j < pitchAnalysisStep; j++) {
        const idx = start + j;
        if (idx < totalLength) {
            pitchCurve[idx] = pitch;
        }
    }
  }

  // 2. Main Encoding Loop (AM Modulation) - Per Channel
  const outputBuffer = ctx.createBuffer(numChannels, totalLength, SAMPLE_RATE);

  for(let c = 0; c < numChannels; c++) {
      const inputData = inputBuffer.getChannelData(c);
      const outputData = outputBuffer.getChannelData(c);
      
      const lpf = new LowPassFilter(preset.inputLpfCutoff, SAMPLE_RATE);
      let carrierPhase = 0;

      for (let i = 0; i < totalLength; i++) {
        // A. Filter Speech (Band limit to avoid aliasing when shifted up)
        let speechSample = lpf.process(inputData[i]);
        
        // Normalize speech to mostly positive range (0.0 to 1.0) to drive envelope
        const modulationIndex = 0.8; 
        const envelope = 1.0 + (speechSample * 3.0 * modulationIndex); // 3.0 is input gain

        // B. Calculate Carrier Frequency based on Pitch
        const currentPitch = pitchCurve[i];
        const carrierFreq = preset.carrierBaseFreq + (currentPitch * preset.pitchMultiplier);
        
        // C. Generate Carrier
        carrierPhase += 2 * Math.PI * carrierFreq / SAMPLE_RATE;
        // Add slight Frequency Modulation (Vibrato) to make it sound more organic
        const vibrato = Math.sin(i * 0.001) * 50; // Slow waver
        
        // D. Modulate
        // Envelope (Speech) * Carrier (Bird Tone)
        let sample = envelope * Math.sin(carrierPhase + vibrato);

        // Soft clip to prevent harsh digital overs if gain is too high
        sample = Math.tanh(sample * 0.5);

        outputData[i] = sample;
      }
      
      // Yield
      await new Promise(r => setTimeout(r, 0));
  }

  return outputBuffer;
};

export const decodeFromBirdsong = async (inputBuffer: AudioBuffer, preset: DecodePreset = DECODE_PRESETS[0]): Promise<AudioBuffer> => {
  const ctx = getAudioContext();
  const numChannels = inputBuffer.numberOfChannels;
  const totalLength = inputBuffer.length;
  const outputBuffer = ctx.createBuffer(numChannels, totalLength, SAMPLE_RATE);

  for(let c = 0; c < numChannels; c++) {
      const inputData = inputBuffer.getChannelData(c);
      const outputData = outputBuffer.getChannelData(c);

      // We use a robust Envelope Detector (AM Demodulation)
      // Logic: |Signal| -> LowPass -> DC Block
      
      // Create Filter Chain based on preset
      const filters: LowPassFilter[] = [];
      for(let i = 0; i < preset.filterStages; i++) {
          filters.push(new LowPassFilter(preset.lpfCutoff, SAMPLE_RATE));
      }
      
      const dcBlocker = new DCBlocker();

      for (let i = 0; i < totalLength; i++) {
        const sample = inputData[i];

        // 1. Rectification (Absolute value recovers the envelope)
        const rectified = Math.abs(sample);

        // 2. Steep Low Pass Filter Chain
        let recovered = rectified;
        for(const f of filters) {
            recovered = f.process(recovered);
        }

        // 3. Remove DC Offset
        recovered = dcBlocker.process(recovered);

        // 4. Makeup Gain
        outputData[i] = recovered * preset.gainMultiplier;
      }
      
      await new Promise(r => setTimeout(r, 0));
  }

  return outputBuffer;
};

// --- Utilities ---

export const playBuffer = async (buffer: AudioBuffer): Promise<void> => {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') await ctx.resume();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
};

export const bufferToWavBlob = (buffer: AudioBuffer): Blob => {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  
  const length = buffer.length;
  const dataLength = length * numChannels * 2;
  const headerLength = 44;
  const totalLength = headerLength + dataLength;
  const arrayBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(arrayBuffer);

  const writeString = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, totalLength - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  // Interleave channels
  let offset = 44;
  const channels = [];
  for(let c=0; c<numChannels; c++) channels.push(buffer.getChannelData(c));
  
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numChannels; c++) {
        const s = Math.max(-1, Math.min(1, channels[c][i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
};

export const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
};

export const downloadBuffer = (buffer: AudioBuffer, filename: string) => {
    const blob = bufferToWavBlob(buffer);
    downloadBlob(blob, filename);
};
