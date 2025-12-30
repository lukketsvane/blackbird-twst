import React, { useState, useRef, useEffect } from 'react';
import * as AudioService from './services/audioService';
import { Diagram } from './components/Diagram';
import { Download, Play, Mic, Square, Upload, Lock, Unlock, Zap, Info, X, Pause, Activity } from 'lucide-react';

type Mode = 'idle' | 'recording' | 'playing' | 'encoding' | 'decoding';

export default function BirdsongCodec() {
  const [mode, setMode] = useState<Mode>('idle');
  const [status, setStatus] = useState('IDLE');
  
  // Data State
  const [recordedAudio, setRecordedAudio] = useState<AudioBuffer | null>(null);
  const [encodedAudio, setEncodedAudio] = useState<AudioBuffer | null>(null);
  const [decodedAudio, setDecodedAudio] = useState<AudioBuffer | null>(null);
  
  // UI State
  const [showInfo, setShowInfo] = useState(false);
  const [activePlayback, setActivePlayback] = useState<'input'|'encoded'|'decoded'|null>(null);

  // Audio Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  
  const animationRef = useRef<number>(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // --- Initialization ---
  useEffect(() => {
    const handleResize = () => {
        if (canvasRef.current) {
            const parent = canvasRef.current.parentElement;
            if (parent) {
                // High DPI for Retina Displays
                const dpr = window.devicePixelRatio || 2;
                canvasRef.current.width = parent.clientWidth * dpr;
                canvasRef.current.height = parent.clientHeight * dpr;
            }
        }
    };
    window.addEventListener('resize', handleResize);
    setTimeout(handleResize, 100);
    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationRef.current);
    };
  }, []);

  const ensureAnalyser = () => {
    const ctx = AudioService.getAudioContext();
    if (!analyserRef.current) {
      analyserRef.current = ctx.createAnalyser();
      analyserRef.current.fftSize = 512; // Higher res for sharper look
      analyserRef.current.smoothingTimeConstant = 0.5;
    }
    return analyserRef.current;
  };

  const stopAudio = () => {
    cancelAnimationFrame(animationRef.current);
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch(e) {}
      try { sourceRef.current.disconnect(); } catch(e) {}
      sourceRef.current = null;
    }
    if (mediaStreamSourceRef.current) {
      try { mediaStreamSourceRef.current.disconnect(); } catch(e) {}
      mediaStreamSourceRef.current = null;
    }
    setActivePlayback(null);
  };

  // --- High Contrast Visualizer ---
  const drawBars = (isActive: boolean) => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    
    // Clear
    ctx.clearRect(0, 0, width, height);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    const barCount = 64; // More bars for density
    const step = Math.floor(bufferLength / barCount);
    const barWidth = (width / barCount); 

    ctx.fillStyle = isActive ? '#FFFFFF' : '#333333';

    for (let i = 0; i < barCount; i++) {
        let sum = 0;
        for (let j=0; j<step; j++) {
            sum += dataArray[i*step + j];
        }
        const avg = sum / step;

        // Sharp, mechanical movement
        const val = isActive 
            ? (avg / 255) 
            : 0.05; 

        const barHeight = Math.max(2, val * height);
        const x = i * barWidth;
        const y = height - barHeight;

        // Crisp Rectangles
        ctx.fillRect(x, y, barWidth - 2, barHeight); // -2 for gap
    }
  };

  // --- Logic ---

  const startRecording = async () => {
    stopAudio();
    try {
      const ctx = AudioService.getAudioContext();
      if (ctx.state === 'suspended') await ctx.resume();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      chunksRef.current = [];
      
      const analyser = ensureAnalyser();
      const source = ctx.createMediaStreamSource(stream);
      mediaStreamSourceRef.current = source;
      source.connect(analyser);
      
      mediaRecorderRef.current.ondataavailable = (e) => chunksRef.current.push(e.data);
      mediaRecorderRef.current.onstop = async () => {
        if (mediaStreamSourceRef.current) {
             try { mediaStreamSourceRef.current.disconnect(); } catch(e) {}
             mediaStreamSourceRef.current = null;
        }
        stream.getTracks().forEach(track => track.stop());

        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        try {
            const arrayBuffer = await blob.arrayBuffer();
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
            setRecordedAudio(audioBuffer);
            setEncodedAudio(null);
            setDecodedAudio(null);
            setStatus('Recorded');
        } catch (e) {
            setStatus('Error');
        }
        setMode('idle');
        cancelAnimationFrame(animationRef.current);
        drawBars(false);
      };
      
      mediaRecorderRef.current.start();
      setMode('recording');
      setStatus('Recording...');
      
      const animate = () => {
        if (mediaRecorderRef.current?.state === 'recording') {
            drawBars(true);
            animationRef.current = requestAnimationFrame(animate);
        }
      };
      animationRef.current = requestAnimationFrame(animate);

    } catch (err) {
      console.error(err);
      setStatus('No Mic');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const encode = async () => {
    if (!recordedAudio) return;
    stopAudio();
    setMode('encoding');
    setStatus('Encrypting...');
    
    await new Promise(r => setTimeout(r, 100));

    try {
      const out = await AudioService.encodeToBirdsong(recordedAudio);
      setEncodedAudio(out);
      setDecodedAudio(null);
      setStatus('Encrypted');
      setMode('idle');
    } catch (e) { 
        setStatus('Error'); 
        setMode('idle');
    } 
  };

  const decode = async () => {
    if (!encodedAudio) return;
    stopAudio();
    setMode('decoding');
    setStatus('Reviving...');
    await new Promise(r => setTimeout(r, 100));

    try {
      const out = await AudioService.decodeFromBirdsong(encodedAudio);
      setDecodedAudio(out);
      setStatus('Revived');
      setMode('idle');
    } catch (e) { 
        setStatus('Error'); 
        setMode('idle');
    }
  };

  const play = async (buffer: AudioBuffer, type: 'input' | 'encoded' | 'decoded') => {
    if (activePlayback === type) {
        stopAudio();
        return; 
    }
    
    stopAudio();
    const ctx = AudioService.getAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    sourceRef.current = source;
    
    const analyser = ensureAnalyser();
    source.connect(analyser);
    analyser.connect(ctx.destination);
    
    source.onended = () => {
        setMode('idle');
        setActivePlayback(null);
        cancelAnimationFrame(animationRef.current);
        sourceRef.current = null;
        drawBars(false);
    };
    
    source.start();
    setMode('playing');
    setActivePlayback(type);

    const animate = () => {
        drawBars(true);
        animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, isArtifact: boolean) => {
    const file = e.target.files?.[0];
    if (!file) return;
    stopAudio();
    try {
        const ctx = AudioService.getAudioContext();
        if (ctx.state === 'suspended') await ctx.resume();
        const ab = await file.arrayBuffer();
        const buffer = await ctx.decodeAudioData(ab);
        
        if (isArtifact) {
            setEncodedAudio(buffer);
            setRecordedAudio(null);
            setDecodedAudio(null);
            setStatus('Artifact Loaded');
            play(buffer, 'encoded');
        } else {
            setRecordedAudio(buffer);
            setEncodedAudio(null);
            setDecodedAudio(null);
            setStatus('Source Loaded');
            play(buffer, 'input');
        }
    } catch (e) { setStatus('Invalid WAV'); }
  };

  return (
    <div className="fixed inset-0 bg-black text-white flex flex-col safe-pt safe-pb p-4 gap-3 overflow-hidden select-none">
        
        {/* 1. SPECTRAL ANALYSIS (Visualizer) */}
        <div className="flex-[1.2] min-h-0 relative bg-black rounded-lg border border-[#333] overflow-hidden flex flex-col">
             {/* Header */}
            <div className="absolute top-4 left-4 right-4 flex justify-between items-center z-20">
                <span className="text-xs font-medium text-[#666] tracking-tight">Spectral Analysis</span>
                <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${mode === 'recording' || activePlayback ? 'bg-white' : 'bg-[#333]'}`} />
                    <span className={`text-xs font-mono font-medium ${mode === 'recording' || activePlayback ? 'text-white' : 'text-[#444]'}`}>
                        {status}
                    </span>
                </div>
            </div>
            
            {/* Bars Canvas */}
            <div className="flex-1 w-full relative flex items-end justify-center px-4 pb-0">
                 <canvas ref={canvasRef} className="w-full h-[70%] block" />
            </div>

            {/* Info Button */}
            <button 
                onClick={() => setShowInfo(true)}
                className="absolute top-4 right-4 p-1 text-[#666] hover:text-white transition-colors z-30"
            >
                <Info size={16} />
            </button>
        </div>

        {/* 2. ACTION GRID */}
        <div className="flex-1 min-h-[180px] grid grid-cols-2 gap-3">
            
            {/* ENCRYPTION CARD */}
            <div className="relative bg-black rounded-lg border border-[#333] flex flex-col items-center justify-center gap-4 group hover:border-[#555] transition-colors">
                
                <label className="absolute top-3 right-3 p-2 text-[#444] hover:text-white cursor-pointer transition-colors active:scale-90 z-20">
                    <Upload size={16} />
                    <input type="file" accept=".wav,audio/wav,audio/*" onChange={(e) => handleUpload(e, false)} className="hidden" />
                </label>

                <div className="absolute top-4 left-4">
                    <span className="text-xs font-medium text-[#666]">Encryption</span>
                </div>

                {!recordedAudio ? (
                    <button
                        onMouseDown={startRecording}
                        onMouseUp={stopRecording}
                        onTouchStart={startRecording}
                        onTouchEnd={stopRecording}
                        className={`
                            w-16 h-16 rounded-full flex items-center justify-center transition-all duration-200 border
                            ${mode === 'recording' 
                                ? 'bg-white text-black border-white' 
                                : 'bg-black text-white border-[#333] hover:bg-[#111] hover:border-[#666]'}
                        `}
                    >
                        {mode === 'recording' ? <Square size={20} fill="currentColor" /> : <Mic size={24} />}
                    </button>
                ) : (
                     <button
                        onClick={encode}
                        disabled={mode === 'encoding'}
                        className="w-16 h-16 rounded-full flex items-center justify-center transition-all duration-200 bg-white text-black hover:scale-105"
                    >
                        <Zap size={24} fill="currentColor" />
                    </button>
                )}

                <span className="text-[11px] font-medium text-[#666]">
                    {mode === 'recording' ? 'Recording...' : recordedAudio ? (mode === 'encoding' ? 'Processing...' : 'Ready to Encrypt') : 'Hold to Record'}
                </span>
                
                {recordedAudio && !mode && (
                    <button onClick={() => setRecordedAudio(null)} className="absolute bottom-3 text-[10px] text-[#444] hover:text-white transition-colors font-medium">
                        Discard
                    </button>
                )}
            </div>

            {/* DECRYPTION CARD */}
            <div className="relative bg-black rounded-lg border border-[#333] flex flex-col items-center justify-center gap-4 hover:border-[#555] transition-colors">
                 
                <label className="absolute top-3 right-3 p-2 text-[#444] hover:text-white cursor-pointer transition-colors active:scale-90 z-20">
                    <Upload size={16} />
                    <input type="file" accept=".wav,audio/wav,audio/*" onChange={(e) => handleUpload(e, true)} className="hidden" />
                </label>

                <div className="absolute top-4 left-4">
                    <span className="text-xs font-medium text-[#666]">Decryption</span>
                </div>

                <button
                    onClick={decode}
                    disabled={!encodedAudio || mode === 'decoding'}
                    className={`
                        w-16 h-16 rounded-full flex items-center justify-center transition-all duration-200 border
                        ${encodedAudio 
                            ? 'bg-white text-black border-white hover:scale-105' 
                            : 'bg-[#050505] text-[#222] border-[#222] cursor-not-allowed'}
                    `}
                >
                    {encodedAudio ? <Unlock size={24} /> : <Lock size={24} />}
                </button>

                <span className="text-[11px] font-medium text-[#666]">
                    {mode === 'decoding' ? 'Processing...' : encodedAudio ? 'Ready to Revive' : 'Waiting for Data'}
                </span>
            </div>

        </div>

        {/* 3. ARTIFACT PLAYER */}
        <div className="h-[72px] shrink-0 bg-black rounded-lg border border-[#333] flex items-center px-4 gap-4 relative overflow-hidden group hover:border-[#555] transition-colors">
             {/* Active Progress */}
             {activePlayback && (
                <div className="absolute bottom-0 left-0 h-[2px] bg-white w-full animate-pulse opacity-50" />
             )}

             {/* Play Icon Box */}
             <div className={`
                w-10 h-10 rounded-md flex items-center justify-center shrink-0 transition-all duration-300 border
                ${activePlayback ? 'bg-white text-black border-white' : 'bg-[#111] text-white border-[#333]'}
             `}>
                {activePlayback ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
             </div>

             {/* Info */}
             <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                <div className="text-sm font-medium truncate text-white">
                    {decodedAudio ? "revived_audio.wav" : encodedAudio ? "artifact_specimen.wav" : recordedAudio ? "source_input.wav" : "No File Loaded"}
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[#555] font-mono">
                        {(decodedAudio || encodedAudio || recordedAudio)?.duration.toFixed(2) || "--"}s
                    </span>
                    {(decodedAudio || encodedAudio || recordedAudio) && (
                         <span className="text-[9px] bg-[#222] text-[#888] px-1.5 py-px rounded font-medium">WAV</span>
                    )}
                </div>
             </div>

             {/* Actions */}
             <div className="flex items-center gap-2">
                 <button 
                    onClick={() => {
                        if (decodedAudio) play(decodedAudio, 'decoded');
                        else if (encodedAudio) play(encodedAudio, 'encoded');
                        else if (recordedAudio) play(recordedAudio, 'input');
                    }}
                    disabled={!encodedAudio && !recordedAudio && !decodedAudio}
                    className="absolute inset-0 z-10 cursor-pointer"
                    aria-label="Play Toggle"
                 />

                 <button 
                    onClick={(e) => {
                        e.stopPropagation(); 
                        if (decodedAudio) AudioService.downloadBuffer(decodedAudio, 'revived.wav');
                        else if (encodedAudio) AudioService.downloadBuffer(encodedAudio, 'artifact.wav');
                        else if (recordedAudio) AudioService.downloadBuffer(recordedAudio, 'source.wav');
                    }}
                    disabled={!encodedAudio && !recordedAudio && !decodedAudio}
                    className="p-2 text-[#444] hover:text-white z-20 transition-colors active:scale-90"
                >
                    <Download size={18} />
                 </button>
             </div>
        </div>

      {/* Info Modal */}
      {showInfo && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
            <div className="w-full max-w-lg bg-black border border-[#333] rounded-lg p-6 shadow-2xl">
                <div className="flex justify-between items-center mb-6">
                     <h2 className="text-sm font-semibold text-white">System Architecture</h2>
                     <button onClick={() => setShowInfo(false)} className="text-[#666] hover:text-white">
                        <X size={18} />
                     </button>
                </div>
                <Diagram />
            </div>
        </div>
      )}

    </div>
  );
}