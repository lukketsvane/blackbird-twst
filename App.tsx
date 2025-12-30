import React, { useState, useRef, useEffect } from 'react';
import * as AudioService from './services/audioService';
import { Diagram } from './components/Diagram';
import { Download, Play, Mic, Square, Upload, Lock, Unlock, Zap, Info, X, Pause } from 'lucide-react';

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
      analyserRef.current.fftSize = 256; // Good balance for bar count
      analyserRef.current.smoothingTimeConstant = 0.6; // Smoother fallback
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

  // --- Gold Bar Visualizer ---
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

    // Aesthetics
    const gap = 4 * (window.devicePixelRatio || 2); 
    const barCount = 40; // Fixed number of bars for the "look"
    const step = Math.floor(bufferLength / barCount);
    const barWidth = (width / barCount) - gap;

    for (let i = 0; i < barCount; i++) {
        // Average the bin values for this bar to represent the range
        let sum = 0;
        for (let j=0; j<step; j++) {
            sum += dataArray[i*step + j];
        }
        const avg = sum / step;

        const val = isActive 
            ? (avg / 255) 
            : Math.max(0.02, (Math.sin(Date.now()/1000 + i) * 0.05 + 0.05)); // Idle wave

        const barHeight = val * height * 0.9;
        const x = i * (barWidth + gap) + (gap/2);
        const y = height - barHeight;

        // Gradient Gold
        const gradient = ctx.createLinearGradient(0, y, 0, height);
        gradient.addColorStop(0, 'rgba(234, 179, 8, 0.9)'); // Yellow-500
        gradient.addColorStop(1, 'rgba(234, 179, 8, 0.2)');

        ctx.fillStyle = isActive ? gradient : 'rgba(255, 255, 255, 0.05)';
        
        // Rounded top bars
        ctx.beginPath();
        const r = barWidth / 2;
        ctx.moveTo(x, y + r);
        ctx.arc(x + r, y + r, r, Math.PI, 0);
        ctx.lineTo(x + barWidth, height);
        ctx.lineTo(x, height);
        ctx.closePath();
        ctx.fill();
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
            setStatus('RECORDED');
        } catch (e) {
            setStatus('ERROR');
        }
        setMode('idle');
        cancelAnimationFrame(animationRef.current);
        drawBars(false);
      };
      
      mediaRecorderRef.current.start();
      setMode('recording');
      setStatus('RECORDING');
      
      const animate = () => {
        if (mediaRecorderRef.current?.state === 'recording') {
            drawBars(true);
            animationRef.current = requestAnimationFrame(animate);
        }
      };
      animationRef.current = requestAnimationFrame(animate);

    } catch (err) {
      console.error(err);
      setStatus('MIC PERMISSION');
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
    setStatus('ENCRYPTING...');
    
    await new Promise(r => setTimeout(r, 100)); // UI Render

    try {
      const out = await AudioService.encodeToBirdsong(recordedAudio);
      setEncodedAudio(out);
      setDecodedAudio(null);
      setStatus('ENCRYPTED');
      setMode('idle');
    } catch (e) { 
        setStatus('ERROR'); 
        setMode('idle');
    } 
  };

  const decode = async () => {
    if (!encodedAudio) return;
    stopAudio();
    setMode('decoding');
    setStatus('REVIVING...');
    await new Promise(r => setTimeout(r, 100));

    try {
      const out = await AudioService.decodeFromBirdsong(encodedAudio);
      setDecodedAudio(out);
      setStatus('REVIVED');
      setMode('idle');
    } catch (e) { 
        setStatus('ERROR'); 
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

  // --- Upload Handling (iOS Compatible) ---
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
            setStatus('ARTIFACT LOADED');
            play(buffer, 'encoded');
        } else {
            setRecordedAudio(buffer);
            setEncodedAudio(null);
            setDecodedAudio(null);
            setStatus('SOURCE LOADED');
            play(buffer, 'input');
        }
    } catch (e) { setStatus('INVALID WAV'); }
  };

  return (
    <div className="fixed inset-0 bg-[#050505] text-[#e5e5e5] font-mono flex flex-col safe-pt safe-pb p-4 gap-4 overflow-hidden select-none">
        
        {/* Background Grid */}
        <div className="absolute inset-0 bg-grid-pattern opacity-40 pointer-events-none" />

        {/* 1. SPECTRAL ANALYSIS (Visualizer) */}
        <div className="flex-[1.5] min-h-0 relative bg-[#0A0A0A] rounded-[32px] border border-white/5 overflow-hidden flex flex-col">
             {/* Header */}
            <div className="absolute top-6 left-6 right-6 flex justify-between items-center z-20">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#666]">Spectral Analysis</span>
                <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${mode === 'recording' || activePlayback ? 'bg-yellow-500 animate-pulse' : 'bg-[#333]'}`} />
                    <span className={`text-[10px] tracking-widest font-bold ${mode === 'recording' || activePlayback ? 'text-yellow-500' : 'text-[#333]'}`}>
                        {status}
                    </span>
                </div>
            </div>
            
            {/* Bars Canvas */}
            <div className="flex-1 w-full relative flex items-end justify-center px-6 pb-0">
                 <canvas ref={canvasRef} className="w-full h-[80%] block opacity-90" />
            </div>

            {/* Info Button */}
            <button 
                onClick={() => setShowInfo(true)}
                className="absolute top-6 right-6 p-2 -mr-2 -mt-2 text-[#333] hover:text-white transition-colors z-30"
            >
                <Info size={16} />
            </button>
        </div>

        {/* 2. ACTION GRID */}
        <div className="flex-1 min-h-[220px] grid grid-cols-2 gap-4">
            
            {/* ENCRYPTION CARD */}
            <div className={`
                relative bg-[#0A0A0A] rounded-[32px] flex flex-col items-center justify-center gap-5
                border transition-all duration-300 group
                ${mode === 'recording' ? 'border-yellow-500/50 shadow-[0_0_40px_-10px_rgba(234,179,8,0.3)]' : 'border-white/5'}
            `}>
                {/* Upload Action */}
                <label className="absolute top-5 right-5 w-8 h-8 flex items-center justify-center rounded-full bg-[#151515] text-[#444] hover:text-white hover:bg-[#222] transition-colors cursor-pointer border border-white/5 active:scale-90 z-20">
                    <Upload size={12} />
                    <input type="file" accept=".wav,audio/wav,audio/*" onChange={(e) => handleUpload(e, false)} className="hidden" />
                </label>

                <div className="absolute top-5 left-6">
                    <span className={`text-[9px] font-bold uppercase tracking-[0.2em] ${mode === 'recording' ? 'text-yellow-500' : 'text-[#555]'}`}>
                        Encryption
                    </span>
                </div>

                {/* Main Action Button */}
                {!recordedAudio ? (
                    <button
                        onMouseDown={startRecording}
                        onMouseUp={stopRecording}
                        onTouchStart={startRecording}
                        onTouchEnd={stopRecording}
                        className={`
                            w-20 h-20 rounded-full flex items-center justify-center transition-all duration-200
                            ${mode === 'recording' 
                                ? 'bg-yellow-500 text-black scale-110 shadow-lg' 
                                : 'bg-yellow-500 text-black hover:scale-105 hover:brightness-110 shadow-[0_0_20px_rgba(234,179,8,0.2)]'}
                        `}
                    >
                        {mode === 'recording' ? <Square size={24} fill="currentColor" /> : <Mic size={28} />}
                    </button>
                ) : (
                     <button
                        onClick={encode}
                        disabled={mode === 'encoding'}
                        className={`
                            w-20 h-20 rounded-full flex items-center justify-center transition-all duration-200
                            bg-yellow-500 text-black animate-in zoom-in
                            ${mode === 'encoding' ? 'animate-pulse' : 'hover:scale-105'}
                        `}
                    >
                        <Zap size={28} fill={mode === 'encoding' ? "currentColor" : "none"} />
                    </button>
                )}

                <span className={`text-[10px] uppercase tracking-widest font-bold ${mode === 'recording' ? 'text-yellow-500' : 'text-[#444]'}`}>
                    {mode === 'recording' ? 'Recording...' : recordedAudio ? (mode === 'encoding' ? 'Encrypting...' : 'Encrypt') : 'Hold to Record'}
                </span>
                
                {recordedAudio && !mode && (
                    <button onClick={() => setRecordedAudio(null)} className="absolute bottom-4 text-[9px] text-red-500/40 hover:text-red-500 uppercase tracking-widest px-4 py-2">
                        Discard
                    </button>
                )}
            </div>

            {/* DECRYPTION CARD */}
            <div className={`
                relative bg-[#0A0A0A] rounded-[32px] flex flex-col items-center justify-center gap-5 border 
                transition-all duration-300
                ${encodedAudio ? 'border-violet-500/30 shadow-[0_0_30px_-10px_rgba(139,92,246,0.15)]' : 'border-white/5'}
            `}>
                 {/* Upload Action */}
                <label className="absolute top-5 right-5 w-8 h-8 flex items-center justify-center rounded-full bg-[#151515] text-[#444] hover:text-white hover:bg-[#222] transition-colors cursor-pointer border border-white/5 active:scale-90 z-20">
                    <Upload size={12} />
                    <input type="file" accept=".wav,audio/wav,audio/*" onChange={(e) => handleUpload(e, true)} className="hidden" />
                </label>

                <div className="absolute top-5 left-6">
                    <span className={`text-[9px] font-bold uppercase tracking-[0.2em] ${encodedAudio ? 'text-violet-500' : 'text-[#555]'}`}>
                        Decryption
                    </span>
                </div>

                <button
                    onClick={decode}
                    disabled={!encodedAudio || mode === 'decoding'}
                    className={`
                        w-20 h-20 rounded-full flex items-center justify-center transition-all duration-200
                        ${encodedAudio 
                            ? 'bg-violet-600 text-white shadow-[0_0_20px_rgba(124,58,237,0.4)] hover:scale-105 hover:bg-violet-500' 
                            : 'bg-[#121212] text-[#333] border border-white/5 cursor-not-allowed'}
                        ${mode === 'decoding' ? 'animate-pulse' : ''}
                    `}
                >
                    {encodedAudio ? <Unlock size={28} /> : <Lock size={28} />}
                </button>

                <span className={`text-[10px] uppercase tracking-widest font-bold ${encodedAudio ? 'text-violet-400' : 'text-[#444]'}`}>
                    {mode === 'decoding' ? 'Reviving...' : encodedAudio ? 'Revive Audio' : 'Waiting...'}
                </span>
            </div>

        </div>

        {/* 3. ARTIFACT PLAYER */}
        <div className="h-[96px] shrink-0 bg-[#0A0A0A] rounded-[24px] border border-white/5 flex items-center px-6 gap-5 relative overflow-hidden group">
             {/* Progress Bar Background */}
             <div className="absolute bottom-0 left-0 h-1 bg-white/5 w-full" />
             {/* Active Progress */}
             {activePlayback && (
                <div className="absolute bottom-0 left-0 h-1 bg-yellow-500/80 w-1/3 animate-[pulse_2s_infinite]" />
             )}

             {/* Play Icon Box */}
             <div className={`
                w-14 h-14 rounded-[18px] flex items-center justify-center shrink-0 transition-all duration-300
                ${activePlayback ? 'bg-yellow-500 text-black shadow-[0_0_20px_-5px_rgba(234,179,8,0.4)]' : 'bg-[#151515] text-[#333] border border-white/5'}
             `}>
                {activePlayback ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
             </div>

             {/* Info */}
             <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
                <div className="text-sm font-bold truncate text-[#e5e5e5] tracking-tight">
                    {decodedAudio ? "revived_audio.wav" : encodedAudio ? "artifact_specimen.wav" : recordedAudio ? "source_input.wav" : "No File Loaded"}
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[9px] bg-[#1A1A1A] text-[#666] px-1.5 py-0.5 rounded-[4px] uppercase font-bold tracking-wider border border-white/5">
                        {encodedAudio || decodedAudio || recordedAudio ? "WAV" : "EMPTY"}
                    </span>
                    <span className="text-[10px] text-[#444] font-mono">
                        {(decodedAudio || encodedAudio || recordedAudio)?.duration.toFixed(2) || "--"}s
                    </span>
                </div>
             </div>

             {/* Actions */}
             <div className="flex items-center gap-3">
                 {/* Invisible Full Click Area for Play Toggle */}
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

                 {/* Download (Z-Index above play toggle) */}
                 <button 
                    onClick={(e) => {
                        e.stopPropagation(); 
                        if (decodedAudio) AudioService.downloadBuffer(decodedAudio, 'revived.wav');
                        else if (encodedAudio) AudioService.downloadBuffer(encodedAudio, 'artifact.wav');
                        else if (recordedAudio) AudioService.downloadBuffer(recordedAudio, 'source.wav');
                    }}
                    disabled={!encodedAudio && !recordedAudio && !decodedAudio}
                    className="w-10 h-10 rounded-full flex items-center justify-center text-[#444] hover:text-white hover:bg-[#222] z-20 transition-colors active:scale-90"
                >
                    <Download size={20} />
                 </button>
             </div>
        </div>

      {/* Info Modal */}
      {showInfo && (
        <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-200">
            <div className="w-full max-w-lg bg-[#0A0A0A] border border-white/10 rounded-3xl p-6 shadow-2xl">
                <div className="flex justify-between items-center mb-6">
                     <h2 className="text-lg font-bold text-white tracking-tight">Codec Architecture</h2>
                     <button onClick={() => setShowInfo(false)} className="w-8 h-8 flex items-center justify-center rounded-full bg-[#151515] text-[#666] hover:text-white">
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
