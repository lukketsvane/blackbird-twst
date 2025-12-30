import React, { useState, useRef, useEffect } from 'react';
import * as AudioService from './services/audioService';
import * as StorageService from './services/storageService';
import { 
  Mic, Upload, Zap, Lock, Unlock, Play, Pause, 
  Power, Download, Fingerprint, RefreshCw, X,
  History, Trash2, Calendar, ChevronLeft, ChevronRight, Settings2
} from 'lucide-react';

type Tab = 'encode' | 'decode';
type InputType = 'mic' | 'file';
type AppState = 'idle' | 'recording' | 'recorded' | 'processing' | 'completed' | 'playing';

export default function App() {
  // --- State ---
  const [tab, setTab] = useState<Tab>('encode');
  const [inputType, setInputType] = useState<InputType>('mic');
  const [appState, setAppState] = useState<AppState>('idle');
  const [statusText, setStatusText] = useState('READY');
  
  // Presets
  const [encodePresetIndex, setEncodePresetIndex] = useState(0);
  const [decodePresetIndex, setDecodePresetIndex] = useState(0);

  // Audio Buffers
  const [sourceAudio, setSourceAudio] = useState<AudioBuffer | null>(null);
  const [processedAudio, setProcessedAudio] = useState<AudioBuffer | null>(null); // The result (birdsong or speech)

  // UI State
  const [showHistory, setShowHistory] = useState(false);
  const [historyItems, setHistoryItems] = useState<StorageService.HistoryItem[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const streamNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Init ---
  useEffect(() => {
    StorageService.getHistoryItems().then(setHistoryItems);
  }, []);

  // --- Audio Context & Analyser ---
  const ensureAnalyser = () => {
    const ctx = AudioService.getAudioContext();
    if (!analyserRef.current) {
      analyserRef.current = ctx.createAnalyser();
      analyserRef.current.fftSize = 256;
      analyserRef.current.smoothingTimeConstant = 0.7;
    }
    return analyserRef.current;
  };

  const stopAudio = () => {
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch(e) {}
      sourceNodeRef.current = null;
    }
    setIsPlaying(false);
  };

  // --- Visualizer ---
  useEffect(() => {
    const draw = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;

        // Clear with a slight trail effect for CRT feel
        ctx.fillStyle = 'rgba(10, 10, 10, 0.3)';
        ctx.fillRect(0, 0, width, height);

        // Draw Grid (Static) is handled by CSS, we draw waveform/spectrum here
        if (analyserRef.current && (appState === 'recording' || isPlaying || appState === 'processing')) {
            const bufferLength = analyserRef.current.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            analyserRef.current.getByteFrequencyData(dataArray);

            ctx.lineWidth = 2;
            ctx.strokeStyle = '#F59E0B'; // Amber-500
            ctx.beginPath();

            const sliceWidth = width * 1.0 / bufferLength;
            let x = 0;

            // Draw Spectrum Line
            ctx.beginPath();
            for(let i = 0; i < bufferLength; i++) {
                const v = dataArray[i] / 255.0;
                const y = height - (v * height * 0.8) - (height * 0.1); // Center slightly

                if(i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);

                x += sliceWidth;
            }
            ctx.stroke();

            // Glow effect
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#F59E0B';
            ctx.stroke();
            ctx.shadowBlur = 0;
        } else if (appState === 'completed' && !isPlaying) {
             // Flat line
             ctx.beginPath();
             ctx.moveTo(0, height/2);
             ctx.lineTo(width, height/2);
             ctx.strokeStyle = '#333';
             ctx.lineWidth = 1;
             ctx.stroke();
        }

        animationRef.current = requestAnimationFrame(draw);
    };
    
    // Handle Canvas Size (DPI)
    const handleResize = () => {
        if(canvasRef.current && canvasRef.current.parentElement) {
            const dpr = window.devicePixelRatio || 1;
            canvasRef.current.width = canvasRef.current.parentElement.clientWidth * dpr;
            canvasRef.current.height = canvasRef.current.parentElement.clientHeight * dpr;
        }
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    draw();

    return () => {
        window.removeEventListener('resize', handleResize);
        cancelAnimationFrame(animationRef.current);
    };
  }, [appState, isPlaying]);

  // --- Handlers ---

  const reset = () => {
      stopAudio();
      setSourceAudio(null);
      setProcessedAudio(null);
      setAppState('idle');
      setStatusText('READY');
      if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleModeChange = (newTab: Tab) => {
      reset();
      setTab(newTab);
      // Default inputs
      if (newTab === 'decode') {
          setInputType('file'); // Decode always starts with file for now (or mic if we supported listening to birds)
          setStatusText('LOAD ARTIFACT');
      } else {
          setInputType('mic');
          setStatusText('READY');
      }
  };

  const cyclePreset = (direction: 1 | -1) => {
      if (tab === 'encode') {
          setEncodePresetIndex(prev => {
              const len = AudioService.ENCODE_PRESETS.length;
              return (prev + direction + len) % len;
          });
      } else {
          setDecodePresetIndex(prev => {
              const len = AudioService.DECODE_PRESETS.length;
              return (prev + direction + len) % len;
          });
      }
  };

  const getCurrentPresetName = () => {
      if (tab === 'encode') return AudioService.ENCODE_PRESETS[encodePresetIndex].name;
      return AudioService.DECODE_PRESETS[decodePresetIndex].name;
  };
  
  const getCurrentPresetDesc = () => {
      if (tab === 'encode') return AudioService.ENCODE_PRESETS[encodePresetIndex].description;
      return AudioService.DECODE_PRESETS[decodePresetIndex].description;
  };

  const startRecording = async () => {
      if (inputType !== 'mic' || appState !== 'idle') return;
      try {
          const ctx = AudioService.getAudioContext();
          if (ctx.state === 'suspended') await ctx.resume();
          
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const mediaRecorder = new MediaRecorder(stream);
          mediaRecorderRef.current = mediaRecorder;
          chunksRef.current = [];

          // Connect for Visualizer
          const source = ctx.createMediaStreamSource(stream);
          streamNodeRef.current = source;
          const analyser = ensureAnalyser();
          source.connect(analyser);

          mediaRecorder.ondataavailable = (e) => chunksRef.current.push(e.data);
          mediaRecorder.onstop = async () => {
             // Cleanup stream
             source.disconnect();
             stream.getTracks().forEach(t => t.stop());
             
             // Decode
             const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
             const arrayBuffer = await blob.arrayBuffer();
             const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
             setSourceAudio(audioBuffer);
             setAppState('recorded');
             setStatusText('AUDIO CAPTURED');
          };

          mediaRecorder.start();
          setAppState('recording');
          setStatusText('RECORDING...');
      } catch (e) {
          console.error(e);
          setStatusText('MIC ERROR');
      }
  };

  const stopRecording = () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
      }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      
      try {
          setStatusText('LOADING...');
          const ctx = AudioService.getAudioContext();
          const ab = await file.arrayBuffer();
          const buffer = await ctx.decodeAudioData(ab);
          setSourceAudio(buffer);
          setProcessedAudio(null);
          setAppState('recorded'); // 'recorded' here just means 'source ready'
          setStatusText('SOURCE LOADED');
      } catch (err) {
          setStatusText('INVALID FILE');
      }
  };

  const processAudio = async () => {
      if (!sourceAudio) return;
      setAppState('processing');
      setStatusText(tab === 'encode' ? 'ENCRYPTING...' : 'DECODING...');
      
      // Short delay to allow UI render
      await new Promise(r => setTimeout(r, 100));

      try {
          let result: AudioBuffer;
          if (tab === 'encode') {
              const preset = AudioService.ENCODE_PRESETS[encodePresetIndex];
              result = await AudioService.encodeToBirdsong(sourceAudio, preset);
          } else {
              const preset = AudioService.DECODE_PRESETS[decodePresetIndex];
              result = await AudioService.decodeFromBirdsong(sourceAudio, preset);
          }
          setProcessedAudio(result);
          setAppState('completed');
          setStatusText(tab === 'encode' ? 'ENCRYPTION COMPLETE' : 'DECRYPTION COMPLETE');
          
          // Save to History
          const timestamp = Date.now();
          const blob = AudioService.bufferToWavBlob(result);
          const duration = result.duration;
          const id = timestamp.toString() + Math.random().toString(36).substring(7); // simple id
          const filename = tab === 'encode' ? `enc_${timestamp}.wav` : `dec_${timestamp}.wav`;
          
          const newItem: StorageService.HistoryItem = {
              id, type: tab, timestamp, blob, duration, filename
          };
          
          StorageService.saveHistoryItem(newItem).then(() => {
              setHistoryItems(prev => [newItem, ...prev]);
          });

      } catch (e) {
          setAppState('recorded');
          setStatusText('PROCESS FAILED');
      }
  };

  const playAudio = async (buffer: AudioBuffer) => {
      stopAudio();
      const ctx = AudioService.getAudioContext();
      if (ctx.state === 'suspended') await ctx.resume();
      
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      sourceNodeRef.current = source;
      
      const analyser = ensureAnalyser();
      source.connect(analyser);
      analyser.connect(ctx.destination);
      
      source.onended = () => setIsPlaying(false);
      source.start();
      setIsPlaying(true);
  };

  const handleHistoryPlay = async (item: StorageService.HistoryItem) => {
    try {
        const ab = await item.blob.arrayBuffer();
        const ctx = AudioService.getAudioContext();
        const buffer = await ctx.decodeAudioData(ab);
        playAudio(buffer);
        // We stay in the modal or close it? Let's close it so user can see visualizer
        setShowHistory(false);
        setAppState('playing');
        setStatusText('PLAYING FROM LOG');
        // Set as processed audio so "save" works on main screen if they want
        setProcessedAudio(buffer);
        setSourceAudio(null);
    } catch(e) {
        console.error("Playback failed", e);
    }
  };

  const deleteLogItem = async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      await StorageService.deleteHistoryItem(id);
      setHistoryItems(prev => prev.filter(i => i.id !== id));
  };

  const clearLogs = async () => {
      if(confirm("Purge all mission logs? This cannot be undone.")) {
          await StorageService.clearAllHistory();
          setHistoryItems([]);
      }
  };

  // --- Render Helpers ---

  return (
    <div className="min-h-screen bg-[#050505] text-[#eee] font-mono selection:bg-orange-500/30 flex items-center justify-center p-4 md:p-8 overflow-y-auto">
        
        {/* Main Device Chassis */}
        <div className="w-full max-w-md bg-[#000000] rounded-[2.5rem] p-6 relative shadow-2xl border border-[#1a1a1a]">
            
            {/* Screws */}
            <Screw className="top-5 left-5" />
            <Screw className="top-5 right-5" />
            <Screw className="bottom-5 left-5" />
            <Screw className="bottom-5 right-5" />

            {/* HEADER */}
            <div className="mb-6 pl-2 pr-2 flex justify-between items-start z-10 relative">
                <div>
                    <div className="flex items-center gap-3 mb-1">
                        <Fingerprint className="text-amber-600 w-6 h-6" />
                        <h1 className="text-xl font-bold tracking-[0.15em] text-[#e0e0e0]">TURDUS-X1</h1>
                    </div>
                    <div className="text-[#444] text-[10px] tracking-[0.25em] font-medium ml-1">
                        FIELD ENCRYPTOR UNIT
                    </div>
                </div>
                
                <div className="flex gap-2">
                     <button onClick={() => setShowHistory(true)} className="p-2 rounded-full hover:bg-[#111] text-[#444] hover:text-[#888] transition-colors relative">
                        <History size={16} />
                        {historyItems.length > 0 && <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-amber-600 rounded-full" />}
                     </button>
                     <div className={`w-3 h-3 rounded-full mt-2 ${appState !== 'idle' ? 'bg-amber-600 shadow-[0_0_8px_rgba(217,119,6,0.6)]' : 'bg-[#222]'}`} />
                </div>
            </div>

            {/* SCREEN (VISUALIZER) */}
            <div className="relative w-full aspect-[4/3] bg-[#080808] rounded-2xl border border-[#222] mb-8 overflow-hidden group">
                 {/* Grid Overlay */}
                 <div className="absolute inset-0 opacity-10 pointer-events-none" 
                     style={{ 
                         backgroundImage: `
                             linear-gradient(rgba(245, 158, 11, 0.3) 1px, transparent 1px), 
                             linear-gradient(90deg, rgba(245, 158, 11, 0.3) 1px, transparent 1px)
                         `, 
                         backgroundSize: '24px 24px' 
                     }}>
                 </div>
                 
                 {/* Vignette */}
                 <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_50%,rgba(0,0,0,0.6)_100%)] pointer-events-none" />

                 {/* Corner UI Text */}
                 <div className="absolute top-4 left-4 text-[10px] font-bold text-amber-700 tracking-wider">
                     MODE: <span className="text-amber-500">{tab.toUpperCase()}</span>
                 </div>
                 <div className="absolute top-4 right-4 text-[10px] font-bold text-amber-700 tracking-wider">
                     INPUT: <span className="text-amber-500">{tab === 'decode' ? 'ARTIFACT' : inputType.toUpperCase()}</span>
                 </div>

                 {/* Main Status Text (Centered) */}
                 {appState === 'idle' && !sourceAudio && (
                     <div className="absolute inset-0 flex flex-col items-center justify-center text-amber-900/40 pointer-events-none">
                         <ActivityIcon />
                         <span className="mt-2 text-xs tracking-widest">SYSTEM READY</span>
                     </div>
                 )}
                 
                 {/* Canvas */}
                 <canvas ref={canvasRef} className="absolute inset-0 w-full h-full mix-blend-screen opacity-90" />
                 
                 {/* Status Bar Bottom */}
                 <div className="absolute bottom-0 left-0 right-0 h-8 bg-[#0a0a0a]/90 border-t border-[#222] flex items-center justify-between px-4 text-[10px] text-[#555]">
                      <span>STATUS: <span className="text-amber-500/80">{statusText}</span></span>
                      <span>{sourceAudio ? `${sourceAudio.duration.toFixed(1)}s` : '--'}</span>
                 </div>
            </div>

            {/* CONTROLS PANEL */}
            <div className="bg-[#0b0b0b] rounded-[2rem] border border-[#1a1a1a] p-1 pb-2 shadow-inner">
                <div className="bg-[#050505] rounded-[1.8rem] border border-[#222] p-5 pb-8 relative overflow-hidden">
                    
                    {/* Top Control Row */}
                    <div className="flex justify-between items-center mb-6 border-b border-[#1a1a1a] pb-4">
                        
                        {/* Mode Switcher */}
                        <div className="flex bg-[#0a0a0a] rounded-lg p-1 border border-[#222] shadow-sm">
                            <button 
                                onClick={() => handleModeChange('encode')}
                                className={`px-4 py-2 rounded-md text-[10px] font-bold tracking-wide transition-all duration-300 ${tab === 'encode' ? 'bg-[#1a1a1a] text-amber-500 shadow-sm border border-[#2a2a2a]' : 'text-[#444] hover:text-[#666]'}`}
                            >
                                ENCODE
                            </button>
                            <button 
                                onClick={() => handleModeChange('decode')}
                                className={`px-4 py-2 rounded-md text-[10px] font-bold tracking-wide transition-all duration-300 ${tab === 'decode' ? 'bg-[#1a1a1a] text-amber-500 shadow-sm border border-[#2a2a2a]' : 'text-[#444] hover:text-[#666]'}`}
                            >
                                DECODE
                            </button>
                        </div>

                        {/* Input Switcher (Only visible in Encode mode usually, but simplified here) */}
                        <div className="flex gap-2">
                             {tab === 'encode' && (
                                <>
                                    <InputButton active={inputType === 'mic'} onClick={() => { if(appState === 'idle') setInputType('mic'); }}>
                                        <Mic size={14} />
                                    </InputButton>
                                    <InputButton active={inputType === 'file'} onClick={() => { if(appState === 'idle') setInputType('file'); }}>
                                        <Upload size={14} />
                                    </InputButton>
                                </>
                             )}
                             {tab === 'decode' && (
                                 <InputButton active={true} onClick={() => {
                                     if(appState === 'idle') fileInputRef.current?.click();
                                 }}>
                                     <Upload size={14} />
                                 </InputButton>
                             )}
                        </div>
                    </div>

                    {/* Preset Selector */}
                    {appState === 'idle' && (
                        <div className="flex items-center justify-between bg-[#0a0a0a] border border-[#222] rounded-lg px-3 py-2 mb-6">
                            <div className="flex items-center gap-2 text-[#444]">
                                <Settings2 size={12} />
                                <span className="text-[9px] font-bold tracking-widest">PRESET</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <button onClick={() => cyclePreset(-1)} className="text-[#444] hover:text-amber-500">
                                    <ChevronLeft size={16} />
                                </button>
                                <div className="flex flex-col items-center w-28">
                                    <span className="text-[10px] font-bold text-amber-500 tracking-wide whitespace-nowrap">{getCurrentPresetName()}</span>
                                    <span className="text-[7px] text-[#555] tracking-tight">{getCurrentPresetDesc().split(' ')[0]}...</span>
                                </div>
                                <button onClick={() => cyclePreset(1)} className="text-[#444] hover:text-amber-500">
                                    <ChevronRight size={16} />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Hidden File Input */}
                    <input 
                        type="file" 
                        ref={fileInputRef}
                        accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.flac,.webm" 
                        className="hidden" 
                        onChange={handleFileUpload} 
                    />

                    {/* Main Interaction Area */}
                    <div className="flex flex-col items-center justify-center gap-6">
                        
                        {/* THE BIG BUTTON */}
                        <div className="relative group">
                            {/* Outer Glow Ring */}
                            <div className={`absolute -inset-4 rounded-full bg-amber-600/5 blur-xl transition-opacity duration-500 ${appState === 'recording' || appState === 'processing' ? 'opacity-100' : 'opacity-0'}`} />
                            
                            <button
                                onMouseDown={inputType === 'mic' && appState === 'idle' ? startRecording : undefined}
                                onMouseUp={inputType === 'mic' && appState === 'recording' ? stopRecording : undefined}
                                onTouchStart={inputType === 'mic' && appState === 'idle' ? startRecording : undefined}
                                onTouchEnd={inputType === 'mic' && appState === 'recording' ? stopRecording : undefined}
                                onClick={() => {
                                    if (inputType === 'file' && appState === 'idle') {
                                        fileInputRef.current?.click();
                                    } else if (appState === 'recorded') {
                                        processAudio();
                                    } else if (appState === 'completed' && processedAudio) {
                                        playAudio(processedAudio);
                                    }
                                }}
                                disabled={appState === 'processing'}
                                className={`
                                    w-24 h-24 rounded-full flex flex-col items-center justify-center border-2 transition-all duration-200 shadow-2xl relative z-10
                                    ${appState === 'recording' ? 'bg-[#e0e0e0] border-[#fff] scale-95' : 'bg-[#0a0a0a] hover:bg-[#111]'}
                                    ${(appState === 'recorded' || appState === 'completed') ? 'border-amber-600/50 shadow-[0_0_15px_rgba(217,119,6,0.2)]' : 'border-[#222]'}
                                    disabled:opacity-50 disabled:cursor-not-allowed
                                `}
                            >
                                {renderMainButtonContent(appState, tab, inputType, isPlaying)}
                            </button>
                            
                            {/* Label under button */}
                            <div className="absolute -bottom-8 left-0 right-0 text-center text-[9px] font-bold tracking-[0.2em] text-[#333]">
                                {appState === 'idle' && inputType === 'mic' ? 'HOLD' : 'PRESS'}
                            </div>
                        </div>

                        {/* Secondary Actions (Reset / Download) */}
                        <div className="h-8 flex items-center gap-4">
                            {(appState === 'completed' || appState === 'recorded') && (
                                <>
                                    <button onClick={reset} className="text-[#444] hover:text-[#888] transition-colors" title="Reset">
                                        <RefreshCw size={16} />
                                    </button>
                                    
                                    {appState === 'completed' && processedAudio && (
                                        <button 
                                            onClick={() => AudioService.downloadBuffer(processedAudio, tab === 'encode' ? 'birdsong_artifact.wav' : 'recovered_speech.wav')} 
                                            className="text-amber-600 hover:text-amber-400 transition-colors flex items-center gap-2 text-xs font-bold tracking-wider"
                                        >
                                            <Download size={16} />
                                            SAVE
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            
        </div>

        {/* LOGS MODAL */}
        {showHistory && (
             <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
                <div className="w-full max-w-lg bg-[#0a0a0a] border border-[#333] rounded-2xl p-6 shadow-2xl relative flex flex-col max-h-[80vh]">
                    <div className="flex justify-between items-center mb-6 shrink-0">
                         <div>
                            <h2 className="text-lg font-bold text-amber-500 mb-1 flex items-center gap-2">
                                <History size={20} /> MISSION LOGS
                            </h2>
                            <p className="text-xs text-[#666]">STORED ARTIFACTS</p>
                         </div>
                         <div className="flex gap-2">
                            {historyItems.length > 0 && (
                                <button onClick={clearLogs} className="p-2 rounded-full bg-[#111] text-[#666] hover:text-red-500 transition-colors" title="Clear All">
                                    <Trash2 size={16} />
                                </button>
                            )}
                            <button onClick={() => setShowHistory(false)} className="p-2 rounded-full hover:bg-[#111] text-[#444] hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                         </div>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto min-h-0 space-y-2 pr-2 custom-scrollbar">
                        {historyItems.length === 0 ? (
                            <div className="h-40 flex flex-col items-center justify-center text-[#333] gap-2">
                                <History size={32} strokeWidth={1} />
                                <span className="text-xs tracking-widest">NO DATA LOGGED</span>
                            </div>
                        ) : (
                            historyItems.map((item) => (
                                <div key={item.id} className="bg-[#050505] border border-[#222] rounded-lg p-3 flex items-center gap-3 group hover:border-amber-900/50 transition-colors">
                                    <div className={`w-8 h-8 rounded flex items-center justify-center bg-[#111] shrink-0 text-[#666] group-hover:text-amber-500`}>
                                        {item.type === 'encode' ? <Zap size={14} /> : <Unlock size={14} />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-bold text-[#aaa] truncate">{item.filename}</div>
                                        <div className="flex items-center gap-2 text-[10px] text-[#555] mt-0.5">
                                            <span className="flex items-center gap-1"><Calendar size={10} /> {new Date(item.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                            <span>•</span>
                                            <span>{item.duration.toFixed(1)}s</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button onClick={() => handleHistoryPlay(item)} className="p-2 text-[#444] hover:text-white hover:bg-[#111] rounded transition-colors">
                                            <Play size={14} />
                                        </button>
                                        <button onClick={() => AudioService.downloadBlob(item.blob, item.filename)} className="p-2 text-[#444] hover:text-white hover:bg-[#111] rounded transition-colors">
                                            <Download size={14} />
                                        </button>
                                        <button onClick={(e) => deleteLogItem(item.id, e)} className="p-2 text-[#444] hover:text-red-500 hover:bg-[#111] rounded transition-colors">
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        )}
    </div>
  );
}

// --- Sub Components ---

const Screw = ({ className }: { className?: string }) => (
    <div className={`absolute w-3 h-3 rounded-full bg-[#151515] border border-[#2a2a2a] flex items-center justify-center ${className}`}>
        <div className="w-1.5 h-[1px] bg-[#333] transform -rotate-45" />
    </div>
);

const InputButton = ({ active, children, onClick }: { active: boolean, children?: React.ReactNode, onClick: () => void }) => (
    <button 
        onClick={onClick}
        className={`w-8 h-8 rounded-full flex items-center justify-center transition-all border ${active ? 'bg-amber-900/20 border-amber-700/50 text-amber-500' : 'bg-[#0a0a0a] border-[#222] text-[#444] hover:border-[#333]'}`}
    >
        {children}
    </button>
);

const ActivityIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
);

// Helper to determine what icon/text to show on the big button
function renderMainButtonContent(state: AppState, tab: Tab, input: InputType, isPlaying: boolean) {
    if (state === 'processing') return <div className="animate-spin text-amber-500"><RefreshCw size={24} /></div>;
    
    if (state === 'completed') {
        if (isPlaying) return <Pause className="text-amber-500" size={32} fill="currentColor" />;
        return <Play className="text-amber-500" size={32} fill="currentColor" />;
    }

    if (state === 'recorded') {
        // Ready to process
        return tab === 'encode' ? <Zap className="text-white" size={28} fill="currentColor" /> : <Unlock className="text-white" size={28} />;
    }

    // Idle State
    if (state === 'idle') {
        if (input === 'mic') {
             // Recording Mode
             return <Power className="text-[#333]" size={32} />;
        } else {
             // File Upload Mode
             return <Upload className="text-[#333]" size={28} />;
        }
    }
    
    // Recording State
    if (state === 'recording') {
        return <div className="w-8 h-8 bg-black rounded shadow-sm" />;
    }

    return null;
}