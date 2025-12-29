
import React, { useState, useRef, useEffect } from 'react';
import * as AudioService from './services/audioService';
import { Diagram } from './components/Diagram';
import { Download, Play, Mic, Square, Upload, RefreshCw, FileAudio, Info, Music } from 'lucide-react';

type Mode = 'idle' | 'recording' | 'playing';

// Color palette for spectrogram
const THEME_COLORS = {
  input: { r: 16, g: 185, b: 129 },   // Emerald-500
  encoded: { r: 245, g: 158, b: 11 }, // Amber-500
  decoded: { r: 139, g: 92, b: 246 }, // Violet-500
  idle: { r: 75, g: 85, b: 99 }       // Gray-600
};

export default function BirdsongCodec() {
  const [mode, setMode] = useState<Mode>('idle');
  const [recordedAudio, setRecordedAudio] = useState<AudioBuffer | null>(null);
  const [encodedAudio, setEncodedAudio] = useState<AudioBuffer | null>(null);
  const [decodedAudio, setDecodedAudio] = useState<AudioBuffer | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState('Ready to record speech');
  const [showInfo, setShowInfo] = useState(false);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const animationRef = useRef<number>(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Initialize analyser on mount
  useEffect(() => {
    const ctx = AudioService.getAudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048; // Higher resolution for spectrogram
    analyser.smoothingTimeConstant = 0.2;
    analyserRef.current = analyser;
  }, []);

  const stopAudio = () => {
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch(e) {}
      sourceRef.current = null;
    }
    cancelAnimationFrame(animationRef.current);
  };

  const drawSpectrogram = (color: {r: number, g: number, b: number}) => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    
    // Get frequency data
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    // Scroll effect: Draw current canvas shifted left
    const scrollSpeed = 2;
    ctx.drawImage(canvas, -scrollSpeed, 0);

    // Clear the new strip on the right
    const x = width - scrollSpeed;
    ctx.fillStyle = '#050505';
    ctx.fillRect(x, 0, scrollSpeed, height);

    // Draw new frequency bins
    // Draw logarithmic-ish scale for better visual
    for (let y = 0; y < height; y++) {
      const i = height - 1 - y;
      // Linear mapping for simplicity in this visualization, 
      // but emphasizing the speech range (lower bins)
      const binIndex = Math.floor(i * (bufferLength / 1.5) / height); 
      
      if (binIndex < bufferLength) {
        const value = dataArray[binIndex];
        if (value > 20) { // Noise threshold
          const alpha = (value / 255);
          ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
          ctx.fillRect(x, y, scrollSpeed, 1);
        }
      }
    }
  };

  const startRecording = async () => {
    stopAudio();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = AudioService.getAudioContext();
      if (ctx.state === 'suspended') await ctx.resume();

      mediaRecorderRef.current = new MediaRecorder(stream);
      chunksRef.current = [];
      
      const source = ctx.createMediaStreamSource(stream);
      
      if (!analyserRef.current) {
         analyserRef.current = ctx.createAnalyser();
         analyserRef.current.fftSize = 2048;
      }
      source.connect(analyserRef.current);
      
      mediaRecorderRef.current.ondataavailable = (e) => {
        chunksRef.current.push(e.data);
      };
      
      mediaRecorderRef.current.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const arrayBuffer = await blob.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        
        setRecordedAudio(audioBuffer);
        // Clear subsequent stages when new input arrives
        setEncodedAudio(null);
        setDecodedAudio(null);
        
        stream.getTracks().forEach(track => track.stop());
        setMode('idle');
        cancelAnimationFrame(animationRef.current);
        setStatus('Recording saved. Ready to encode.');
      };
      
      mediaRecorderRef.current.start();
      setMode('recording');
      setStatus('Recording... Speak slowly for best results');
      
      const animate = () => {
        if (mediaRecorderRef.current?.state === 'recording') {
            drawSpectrogram(THEME_COLORS.input);
            animationRef.current = requestAnimationFrame(animate);
        }
      };
      animationRef.current = requestAnimationFrame(animate);
      
    } catch (err: any) {
      setStatus('Error accessing microphone: ' + err.message);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const encodeTobirdsong = async () => {
    if (!recordedAudio) return;
    stopAudio();

    setIsProcessing(true);
    setStatus('Generating carrier & modulating amplitude...');

    // Small delay to allow UI to update
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
      const outputBuffer = await AudioService.encodeToBirdsong(recordedAudio);
      setEncodedAudio(outputBuffer);
      setDecodedAudio(null); // Invalidate old decode
      setStatus('Encoded to birdsong! Ready to play.');
    } catch (error) {
      console.error(error);
      setStatus('Encoding failed.');
    } finally {
      setIsProcessing(false);
    }
  };

  const decodeFrombirdsong = async () => {
    if (!encodedAudio) return;
    stopAudio();

    setIsProcessing(true);
    setStatus('Recovering envelope via Rectification & LPF...');

    await new Promise(resolve => setTimeout(resolve, 50));

    try {
      const outputBuffer = await AudioService.decodeFromBirdsong(encodedAudio);
      setDecodedAudio(outputBuffer);
      setStatus('Decoded! Play to hear reconstructed speech.');
    } catch (error) {
      console.error(error);
      setStatus('Decoding failed.');
    } finally {
      setIsProcessing(false);
    }
  };

  const playAudio = async (buffer: AudioBuffer, type: 'input' | 'encoded' | 'decoded') => {
    stopAudio();
    const ctx = AudioService.getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    sourceRef.current = source;
    
    if (!analyserRef.current) {
        analyserRef.current = ctx.createAnalyser();
        analyserRef.current.fftSize = 2048;
    }
    
    source.connect(analyserRef.current);
    analyserRef.current.connect(ctx.destination);
    
    source.onended = () => {
        setMode('idle');
        cancelAnimationFrame(animationRef.current);
        sourceRef.current = null;
    };

    source.start();
    setMode('playing');

    const color = THEME_COLORS[type];

    const animate = () => {
        drawSpectrogram(color);
        animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    stopAudio();

    try {
        const ctx = AudioService.getAudioContext();
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

        // Simple heuristic to guess if file is encoded
        if (file.name.toLowerCase().includes('bird') || file.name.toLowerCase().includes('encoded')) {
          setEncodedAudio(audioBuffer);
          setRecordedAudio(null);
          setDecodedAudio(null);
          setStatus('Birdsong loaded. Ready to decode.');
          playAudio(audioBuffer, 'encoded'); 
        } else {
          setRecordedAudio(audioBuffer);
          setEncodedAudio(null);
          setDecodedAudio(null);
          setStatus('Audio loaded. Ready to encode.');
          playAudio(audioBuffer, 'input');
        }
    } catch (err) {
        setStatus('Error loading file. Format not supported.');
    }
  };

  const handleDownloadAll = async () => {
    const now = new Date().toISOString().slice(0,19).replace(/:/g,"-");
    
    if (recordedAudio) {
        AudioService.downloadBuffer(recordedAudio, `blackbird_${now}_1_source.wav`);
        await new Promise(r => setTimeout(r, 800)); 
    }
    if (encodedAudio) {
        AudioService.downloadBuffer(encodedAudio, `blackbird_${now}_2_artifact.wav`);
        await new Promise(r => setTimeout(r, 800));
    }
    if (decodedAudio) {
        AudioService.downloadBuffer(decodedAudio, `blackbird_${now}_3_decoded.wav`);
    }
  };

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animationRef.current);
      if (sourceRef.current) {
          try { sourceRef.current.stop(); } catch(e) {}
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#050505] text-white p-6 font-mono flex items-center justify-center">
      <div className="max-w-4xl w-full">
        <header className="mb-8 text-center">
            <div className="inline-flex items-center justify-center p-3 bg-gray-900 rounded-full mb-4 border border-gray-800">
                <Music className="w-6 h-6 text-emerald-500 mr-2" />
                <span className="text-gray-500">↔</span>
                <span className="text-2xl ml-2">🐦</span>
            </div>
            <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-emerald-400 via-amber-400 to-violet-400 bg-clip-text text-transparent tracking-tight">
            BLACKBIRD CODEC
            </h1>
            <p className="text-gray-500 text-sm uppercase tracking-widest">
            Acoustic Cryptography • Reversible Speech-to-Song
            </p>
        </header>

        <div className="bg-[#0a0a0a] border border-gray-800 rounded-xl p-1 mb-6 shadow-2xl relative overflow-hidden group ring-1 ring-gray-800/50">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 via-amber-500 to-violet-500 opacity-20"></div>
          {/* Spectrogram Canvas */}
          <canvas 
            ref={canvasRef}
            width={800}
            height={200}
            className="w-full h-48 rounded-lg bg-[#020202]"
          />
          <div className="absolute top-4 left-4 text-[10px] text-gray-600 font-bold tracking-widest pointer-events-none select-none">
             SPECTRAL ANALYSIS // {mode.toUpperCase()}
          </div>
        </div>
        
        <div className="bg-[#0a0a0a] border border-gray-800 rounded-lg p-3 mb-8 flex justify-center items-center">
          <div className={`w-2 h-2 rounded-full mr-3 ${isProcessing ? 'bg-amber-500 animate-ping' : 'bg-emerald-500'}`}></div>
          <p className="text-xs uppercase tracking-wider text-gray-300">
             {status}
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {/* Input Section */}
          <div className="bg-[#0a0a0a] border border-gray-800 rounded-xl p-5 hover:border-emerald-900 transition-all duration-300 group">
            <h2 className="text-emerald-500 font-bold mb-4 flex items-center gap-2 text-sm uppercase tracking-wider">
              1. Input Source
            </h2>
            <div className="space-y-3">
              <button
                onClick={mode === 'recording' ? stopRecording : startRecording}
                disabled={isProcessing}
                className={`w-full py-3 px-4 rounded-lg font-bold text-xs uppercase tracking-wide transition-all border flex items-center justify-center gap-2 ${
                  mode === 'recording'
                    ? 'bg-red-900/20 border-red-500/50 text-red-500 animate-pulse'
                    : 'bg-emerald-900/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-900/20 hover:border-emerald-400'
                }`}
              >
                {mode === 'recording' ? <Square size={14} /> : <Mic size={14} />}
                {mode === 'recording' ? 'Stop' : 'Record Speech'}
              </button>
              
              <label className="w-full py-3 px-4 rounded-lg font-bold text-xs uppercase tracking-wide bg-gray-900/50 border border-gray-700 text-gray-400 hover:bg-gray-800 hover:border-gray-600 cursor-pointer text-center transition-all flex items-center justify-center gap-2">
                <Upload size={14} />
                Upload Audio
                <input
                  type="file"
                  accept="audio/*,.wav,.mp3,.m4a,.aac,.flac,.ogg"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
              
              {recordedAudio && (
                <div className="flex gap-2">
                    <button
                    onClick={() => playAudio(recordedAudio, 'input')}
                    className="flex-1 py-3 px-4 rounded-lg font-bold text-xs uppercase tracking-wide bg-gray-800 border border-gray-700 text-gray-300 hover:border-gray-500 transition-all flex items-center justify-center gap-2"
                    >
                    <Play size={14} /> Play
                    </button>
                    <button
                    onClick={() => AudioService.downloadBuffer(recordedAudio, 'source_speech.wav')}
                    className="flex-shrink-0 py-3 px-4 rounded-lg font-bold text-xs uppercase tracking-wide bg-gray-800 border border-gray-700 text-gray-300 hover:border-gray-500 transition-all flex items-center justify-center"
                    >
                    <Download size={14} />
                    </button>
                </div>
              )}
            </div>
          </div>
          
          {/* Encoder Section */}
          <div className="bg-[#0a0a0a] border border-gray-800 rounded-xl p-5 hover:border-amber-900 transition-all duration-300 group">
            <h2 className="text-amber-500 font-bold mb-4 flex items-center gap-2 text-sm uppercase tracking-wider">
              2. Encrypt
            </h2>
            <div className="space-y-3">
              <button
                onClick={encodeTobirdsong}
                disabled={!recordedAudio || isProcessing}
                className="w-full py-3 px-4 rounded-lg font-bold text-xs uppercase tracking-wide bg-amber-900/10 border border-amber-500/30 text-amber-400 hover:bg-amber-900/20 hover:border-amber-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw size={14} className={isProcessing ? "animate-spin" : ""} />
                Encode to Bird
              </button>
              
              {encodedAudio && (
                <div className="flex gap-2">
                    <button
                        onClick={() => playAudio(encodedAudio, 'encoded')}
                        className="flex-1 py-3 px-4 rounded-lg font-bold text-xs uppercase tracking-wide bg-gray-800 border border-gray-700 text-gray-300 hover:border-gray-500 transition-all flex items-center justify-center gap-2"
                    >
                        <Play size={14} /> Play
                    </button>
                    <button
                        onClick={() => AudioService.downloadBuffer(encodedAudio, 'blackbird_artifact.wav')}
                        className="flex-shrink-0 py-3 px-4 rounded-lg font-bold text-xs uppercase tracking-wide bg-gray-800 border border-gray-700 text-gray-300 hover:border-gray-500 transition-all flex items-center justify-center"
                    >
                        <Download size={14} />
                    </button>
                </div>
              )}
            </div>
          </div>
          
          {/* Decoder Section */}
          <div className="bg-[#0a0a0a] border border-gray-800 rounded-xl p-5 hover:border-violet-900 transition-all duration-300 group">
            <h2 className="text-violet-500 font-bold mb-4 flex items-center gap-2 text-sm uppercase tracking-wider">
              3. Decrypt
            </h2>
            <div className="space-y-3">
              <button
                onClick={decodeFrombirdsong}
                disabled={!encodedAudio || isProcessing}
                className="w-full py-3 px-4 rounded-lg font-bold text-xs uppercase tracking-wide bg-violet-900/10 border border-violet-500/30 text-violet-400 hover:bg-violet-900/20 hover:border-violet-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw size={14} className={isProcessing ? "animate-spin" : ""} />
                Decode to Speech
              </button>
              
              {decodedAudio && (
                <div className="flex gap-2">
                    <button
                        onClick={() => playAudio(decodedAudio, 'decoded')}
                        className="flex-1 py-3 px-4 rounded-lg font-bold text-xs uppercase tracking-wide bg-gray-800 border border-gray-700 text-gray-300 hover:border-gray-500 transition-all flex items-center justify-center gap-2"
                    >
                        <Play size={14} /> Play
                    </button>
                    <button
                        onClick={() => AudioService.downloadBuffer(decodedAudio, 'decrypted_speech.wav')}
                        className="flex-shrink-0 py-3 px-4 rounded-lg font-bold text-xs uppercase tracking-wide bg-gray-800 border border-gray-700 text-gray-300 hover:border-gray-500 transition-all flex items-center justify-center"
                    >
                        <Download size={14} />
                    </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Global Action Bar */}
        {(recordedAudio && encodedAudio && decodedAudio) && (
            <div className="flex justify-center mb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <button
                    onClick={handleDownloadAll}
                    className="group relative inline-flex items-center gap-3 px-8 py-4 bg-gray-800 hover:bg-gray-700 border border-gray-600 hover:border-gray-500 rounded-full transition-all"
                >
                    <div className="absolute inset-0 rounded-full bg-gradient-to-r from-emerald-500/20 via-amber-500/20 to-violet-500/20 blur opacity-0 group-hover:opacity-100 transition-opacity" />
                    <FileAudio size={18} className="text-gray-300" />
                    <span className="font-bold text-sm uppercase tracking-wider text-white">Download All Session Files</span>
                    <Download size={18} className="text-gray-300 group-hover:translate-y-0.5 transition-transform" />
                </button>
            </div>
        )}
        
        {/* Info / How it works */}
        <div className="bg-[#0a0a0a] border border-gray-800 rounded-xl p-6 text-gray-400 cursor-pointer hover:bg-gray-900/30 transition-colors" onClick={() => setShowInfo(!showInfo)}>
            <div className="flex items-center justify-between mb-4">
                 <h3 className="text-gray-300 font-bold flex items-center gap-2 uppercase tracking-wider text-sm">
                    <Info size={16} /> How it works
                 </h3>
                 <span className="text-xs text-gray-600">{showInfo ? 'Collapse' : 'Expand'}</span>
            </div>
            
            {showInfo && (
                <div className="animate-in fade-in duration-300">
                    <Diagram />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-xs leading-relaxed mt-4">
                        <div>
                        <h4 className="text-emerald-500 font-bold mb-2 uppercase tracking-wider">Encoding (Speech → AM Bird)</h4>
                        <ul className="list-disc list-inside text-gray-500 space-y-2">
                            <li>Band-limits speech to 2.5kHz (Phone quality).</li>
                            <li>Extracts pitch and maps it to a high-frequency carrier (3kHz - 7kHz).</li>
                            <li>Modulates the <strong>Amplitude</strong> of the carrier with the speech envelope.</li>
                            <li>The result is a chirping carrier that contains the full speech waveform in its volume.</li>
                        </ul>
                        </div>
                        <div>
                        <h4 className="text-violet-500 font-bold mb-2 uppercase tracking-wider">Decoding (Envelope Detection)</h4>
                        <ul className="list-disc list-inside text-gray-500 space-y-2">
                            <li>Takes the absolute value (rectification) of the bird song.</li>
                            <li>Applies a Low Pass Filter at 2.8kHz to remove the high-frequency carrier.</li>
                            <li>Removes DC offset to center the waveform.</li>
                            <li>Result: Crystal clear intelligible speech, regardless of carrier chirps.</li>
                        </ul>
                        </div>
                    </div>
                </div>
            )}
            {!showInfo && (
                <p className="text-xs text-gray-600">
                    Click to reveal the acoustic steganography algorithm details...
                </p>
            )}
        </div>
      </div>
    </div>
  );
}
