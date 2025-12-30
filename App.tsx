import React, { useState, useRef, useEffect } from 'react';
import * as AudioService from './services/audioService';
import * as StorageService from './services/storageService';
import { 
  Mic, Upload, Zap, Lock, Unlock, Play, Pause, 
  Power, Download, Fingerprint, RefreshCw, X,
  History, Trash2, Calendar, ChevronLeft, ChevronRight, Settings2,
  Maximize2
} from 'lucide-react';

type Tab = 'encode' | 'decode';
type InputType = 'mic' | 'file';
type AppState = 'idle' | 'recording' | 'recorded' | 'processing' | 'completed' | 'playing';

// --- Helper Components & Functions ---

const InputButton = ({ active, onClick, children }: { active: boolean, onClick: () => void, children: React.ReactNode }) => (
    <button 
        onClick={onClick}
        className={`p-1.5 rounded-md transition-all duration-300 border ${
            active 
            ? 'bg-[#1a1a1a] border-amber-900/50 text-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.1)]' 
            : 'bg-transparent border-transparent text-[#333] hover:text-[#555]'
        }`}
    >
        {children}
    </button>
);

const ActivityIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-8 h-8 opacity-20"
  >
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </svg>
);

const renderMainButtonContent = (appState: AppState, tab: Tab, inputType: InputType, isPlaying: boolean) => {
    if (appState === 'processing') {
        return <RefreshCw className="animate-spin text-amber-500" size={32} />;
    }
    
    if (appState === 'recording') {
        return <div className="w-8 h-8 bg-amber-500 rounded-sm animate-pulse shadow-[0_0_15px_rgba(245,158,11,0.8)]" />;
    }

    if (appState === 'completed' || appState === 'recorded') {
        if (isPlaying) return <Pause className="text-amber-500" size={32} />;
        return <Play className="text-amber-500 ml-1" size={32} />;
    }

    // Idle
    if (tab === 'decode' || inputType === 'file') {
        return <Upload className="text-[#333] group-hover:text-[#555] transition-colors" size={32} />;
    }

    return <Mic className="text-[#333] group-hover:text-[#555] transition-colors" size={32} />;
};

const getStatusLabel = (appState: AppState, inputType: InputType, isPlaying: boolean) => {
    switch (appState) {
        case 'recording': return 'RECORDING...';
        case 'processing': return 'PROCESSING...';
        case 'playing': return 'PLAYING';
        case 'completed': return isPlaying ? 'PLAYING' : 'PLAY RESULT';
        case 'recorded': return isPlaying ? 'PLAYING' : 'PLAY';
        case 'idle': return inputType === 'mic' ? 'TAP TO RECORD' : 'TAP TO UPLOAD';
        default: return 'READY';
    }
};

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

  const runProcessing = async (buffer: AudioBuffer, modeOverride?: Tab) => {
      const currentMode = modeOverride || tab;
      
      setAppState('processing');
      setStatusText(currentMode === 'encode' ? 'ENCRYPTING...' : 'DECODING...');
      
      // Short delay to allow UI render
      await new Promise(r => setTimeout(r, 100));

      try {
          let result: AudioBuffer;
          if (currentMode === 'encode') {
              const preset = AudioService.ENCODE_PRESETS[encodePresetIndex];
              result = await AudioService.encodeToBirdsong(buffer, preset);
          } else {
              const preset = AudioService.DECODE_PRESETS[decodePresetIndex];
              result = await AudioService.decodeFromBirdsong(buffer, preset);
          }
          setProcessedAudio(result);
          setAppState('completed');
          setStatusText(currentMode === 'encode' ? 'ENCRYPTION COMPLETE' : 'DECRYPTION COMPLETE');
          
          // Save to History
          const timestamp = Date.now();
          const blob = AudioService.bufferToWavBlob(result);
          const duration = result.duration;
          const id = timestamp.toString() + Math.random().toString(36).substring(7); // simple id
          const filename = currentMode === 'encode' ? `enc_${timestamp}.wav` : `dec_${timestamp}.wav`;
          
          const newItem: StorageService.HistoryItem = {
              id, type: currentMode, timestamp, blob, duration, filename
          };
          
          StorageService.saveHistoryItem(newItem).then(() => {
              setHistoryItems(prev => [newItem, ...prev]);
          });

      } catch (e) {
          console.error(e);
          setAppState('recorded');
          setStatusText('PROCESS FAILED');
      }
  };

  const handleModeChange = (newTab: Tab) => {
      // Special workflow: If we just encoded something and switch to decode, 
      // automatically load that result as the source for decoding.
      if (tab === 'encode' && newTab === 'decode' && appState === 'completed' && processedAudio) {
          const artifactBuffer = processedAudio;
          
          // Clean up current playback
          stopAudio();
          
          // Set State for Decode
          setTab('decode');
          setSourceAudio(artifactBuffer); // The encrypted output becomes the input
          setProcessedAudio(null);
          setInputType('file'); // It's effectively a file source
          
          // Initiate decoding immediately with the artifact
          runProcessing(artifactBuffer, 'decode');
      } else {
          // Standard Switching
          reset();
          setTab(newTab);
          // Default inputs
          if (newTab === 'decode') {
              setInputType('file');
              setStatusText('LOAD ARTIFACT');
          } else {
              setInputType('mic');
              setStatusText('READY');
          }
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
             setStatusText('PROCESSING...');
             setAppState('processing');
             
             try {
                const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
                const arrayBuffer = await blob.arrayBuffer();
                const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
                setSourceAudio(audioBuffer);
                // AUTO PROCESS
                runProcessing(audioBuffer);
             } catch(e) {
                 console.error(e);
                 setStatusText('ERROR');
                 setAppState('idle');
             }
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
          setAppState('processing');
          const ctx = AudioService.getAudioContext();
          const ab = await file.arrayBuffer();
          const buffer = await ctx.decodeAudioData(ab);
          setSourceAudio(buffer);
          // AUTO PROCESS
          runProcessing(buffer);
      } catch (err) {
          setStatusText('INVALID FILE');
          setAppState('idle');
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
        // Error silently handled
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
    <div className="h-[100dvh] w-full bg-[#000000] text-[#eee] font-mono selection:bg-orange-500/30 flex flex-col overflow-hidden relative">
        
        {/* HEADER */}
        <div className="pt-[max(env(safe-area-inset-top),1.5rem)] px-3 pb-2 flex justify-between items-start z-10 shrink-0">
            <div>
                <div className="flex items-center gap-2 mb-1">
                    <Fingerprint className="text-amber-600 w-5 h-5" />
                    <h1 className="text-lg font-bold tracking-[0.15em] text-[#e0e0e0]">TURDUS-X1</h1>
                </div>
                <div className="text-[#444] text-[9px] tracking-[0.25em] font-medium ml-1">
                    FIELD UNIT
                </div>
            </div>
            
            <div className="flex gap-2">
                    <button onClick={() => setShowHistory(true)} className="p-2 rounded-full hover:bg-[#111] text-[#444] hover:text-[#888] transition-colors relative">
                    <History size={16} />
                    {historyItems.length > 0 && <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-amber-600 rounded-full" />}
                    </button>
                    <div className={`w-2 h-2 rounded-full mt-2.5 ${appState !== 'idle' ? 'bg-amber-600 shadow-[0_0_8px_rgba(217,119,6,0.6)]' : 'bg-[#222]'}`} />
            </div>
        </div>

        {/* SCREEN (VISUALIZER) - FLEX GROW */}
        <div className="flex-1 relative mx-2 min-h-0 bg-[#080808] rounded-xl border border-[#222] overflow-hidden group">
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
                <div className="absolute top-3 left-3 text-[9px] font-bold text-amber-700 tracking-wider">
                    MODE: <span className="text-amber-500">{tab.toUpperCase()}</span>
                </div>
                <div className="absolute top-3 right-3 text-[9px] font-bold text-amber-700 tracking-wider">
                    INPUT: <span className="text-amber-500">{tab === 'decode' ? 'ARTIFACT' : inputType.toUpperCase()}</span>
                </div>

                {/* Main Status Text (Centered) */}
                {appState === 'idle' && !sourceAudio && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-amber-900/40 pointer-events-none">
                        <ActivityIcon />
                        <span className="mt-2 text-[10px] tracking-widest">SYSTEM READY</span>
                    </div>
                )}
                
                {/* Canvas */}
                <canvas ref={canvasRef} className="absolute inset-0 w-full h-full mix-blend-screen opacity-90" />
                
                {/* Status Bar Bottom */}
                <div className="absolute bottom-0 left-0 right-0 h-6 bg-[#0a0a0a]/90 border-t border-[#222] flex items-center justify-between px-3 text-[9px] text-[#555]">
                    <span>STATUS: <span className="text-amber-500/80">{statusText}</span></span>
                    <span>{sourceAudio ? `${sourceAudio.duration.toFixed(1)}s` : '--'}</span>
                </div>
        </div>

        {/* CONTROLS PANEL */}
        <div className="shrink-0 px-2 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-3 bg-black">
            <div className="bg-[#0b0b0b] rounded-2xl border border-[#1a1a1a] p-3 shadow-inner">
                
                {/* Top Control Row */}
                <div className="flex justify-between items-center mb-3 h-8">
                    {/* Mode Switcher */}
                    <div className="flex bg-[#0a0a0a] rounded-lg p-0.5 border border-[#222] shadow-sm">
                        <button 
                            onClick={() => handleModeChange('encode')}
                            className={`px-3 py-1.5 rounded-md text-[9px] font-bold tracking-wide transition-all duration-300 ${tab === 'encode' ? 'bg-[#1a1a1a] text-amber-500 shadow-sm border border-[#2a2a2a]' : 'text-[#444] hover:text-[#666]'}`}
                        >
                            ENCODE
                        </button>
                        <button 
                            onClick={() => handleModeChange('decode')}
                            className={`px-3 py-1.5 rounded-md text-[9px] font-bold tracking-wide transition-all duration-300 ${tab === 'decode' ? 'bg-[#1a1a1a] text-amber-500 shadow-sm border border-[#2a2a2a]' : 'text-[#444] hover:text-[#666]'}`}
                        >
                            DECODE
                        </button>
                    </div>

                    {/* Input Switcher */}
                    <div className="flex gap-2">
                            {tab === 'encode' && (
                            <>
                                <InputButton active={inputType === 'mic'} onClick={() => { if(appState === 'idle') setInputType('mic'); }}>
                                    <Mic size={12} />
                                </InputButton>
                                <InputButton active={inputType === 'file'} onClick={() => { if(appState === 'idle') setInputType('file'); }}>
                                    <Upload size={12} />
                                </InputButton>
                            </>
                            )}
                            {tab === 'decode' && (
                                <InputButton active={true} onClick={() => {
                                    if(appState === 'idle') fileInputRef.current?.click();
                                }}>
                                    <Upload size={12} />
                                </InputButton>
                            )}
                    </div>
                </div>

                {/* Preset Selector (Always rendered to preserve height, hidden if not idle) */}
                <div className={`transition-opacity duration-200 ${appState === 'idle' ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                    <div className="flex items-center justify-between bg-[#0a0a0a] border border-[#222] rounded-lg px-2 py-1.5 mb-3">
                        <div className="flex items-center gap-1.5 text-[#444]">
                            <Settings2 size={10} />
                            <span className="text-[8px] font-bold tracking-widest">PRESET</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button onClick={() => cyclePreset(-1)} className="text-[#444] hover:text-amber-500">
                                <ChevronLeft size={14} />
                            </button>
                            <div className="flex flex-col items-center w-24">
                                <span className="text-[9px] font-bold text-amber-500 tracking-wide whitespace-nowrap">{getCurrentPresetName()}</span>
                                <span className="text-[7px] text-[#555] tracking-tight">{getCurrentPresetDesc().split(' ')[0]}...</span>
                            </div>
                            <button onClick={() => cyclePreset(1)} className="text-[#444] hover:text-amber-500">
                                <ChevronRight size={14} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Hidden File Input */}
                <input 
                    type="file" 
                    ref={fileInputRef}
                    accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.flac,.webm" 
                    className="hidden" 
                    onChange={handleFileUpload} 
                />

                {/* Frame Works Ripple Container - MAX HEIGHT/WIDTH */}
                <div className="w-full h-32 relative group">
                    <button
                        onMouseDown={inputType === 'mic' && appState === 'idle' ? startRecording : undefined}
                        onMouseUp={inputType === 'mic' && appState === 'recording' ? stopRecording : undefined}
                        onTouchStart={inputType === 'mic' && appState === 'idle' ? startRecording : undefined}
                        onTouchEnd={inputType === 'mic' && appState === 'recording' ? stopRecording : undefined}
                        onClick={() => {
                            if (inputType === 'file' && appState === 'idle') {
                                fileInputRef.current?.click();
                            } else if (appState === 'completed' && processedAudio) {
                                playAudio(processedAudio);
                            }
                        }}
                        disabled={appState === 'processing'}
                        className={`
                            w-full h-full rounded-xl border border-[#222] bg-[#080808]
                            flex flex-col items-center justify-center relative overflow-hidden transition-all duration-300
                            ${appState === 'idle' ? 'hover:border-amber-900/40 hover:bg-[#0a0a0a] cursor-pointer' : ''}
                            ${appState === 'recording' ? 'border-amber-600/50 bg-[#0a0a0a]' : ''}
                            ${appState === 'completed' ? 'border-green-900/30' : ''}
                        `}
                    >
                        {/* ABSTRACT RIPPLE BACKGROUND */}
                        {(appState === 'idle' || appState === 'recording') && (
                            <>
                                {/* Inner Animated Frame (Active when recording or hovering) */}
                                <div className={`absolute inset-3 border border-[#1a1a1a] rounded-lg transition-all duration-500 ${appState === 'recording' ? 'scale-95 border-amber-900/40 animate-pulse' : ''}`} />
                                
                                {/* Center Element */}
                                <div className={`absolute inset-0 flex items-center justify-center pointer-events-none`}>
                                    {/* Ripples */}
                                    <div className={`w-[60%] h-[70%] border border-[#111] rounded-[50%] absolute transition-all duration-700 ${appState === 'recording' ? 'scale-110 border-amber-800/20 opacity-100' : 'opacity-20'}`} />
                                    <div className={`w-[45%] h-[55%] border border-[#111] rounded-[50%] absolute transition-all duration-700 delay-75 ${appState === 'recording' ? 'scale-125 border-amber-800/20 opacity-100' : 'opacity-20'}`} />
                                    <div className={`w-[30%] h-[40%] border border-[#111] rounded-[50%] absolute transition-all duration-700 delay-150 ${appState === 'recording' ? 'scale-150 border-amber-800/20 opacity-100' : 'opacity-20'}`} />
                                </div>
                            </>
                        )}

                        {/* CONTENT OVERLAY */}
                        <div className="relative z-10 flex flex-col items-center justify-center gap-1">
                            {renderMainButtonContent(appState, tab, inputType, isPlaying)}
                            
                            {/* Text Prompts */}
                            <span className="text-[9px] font-bold tracking-[0.2em] text-[#444] mt-1">
                                {getStatusLabel(appState, inputType, isPlaying)}
                            </span>
                        </div>
                    </button>
                    
                     {/* Corner Frame Markers (Decoration) */}
                    <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-[#333] pointer-events-none" />
                    <div className="absolute top-0 right-0 w-3 h-3 border-t border-r border-[#333] pointer-events-none" />
                    <div className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-[#333] pointer-events-none" />
                    <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-[#333] pointer-events-none" />
                </div>

                {/* Secondary Actions (Reset / Download) - Always occupy height */}
                <div className="h-8 mt-3 flex items-center justify-center gap-4">
                    {(appState === 'completed' || appState === 'recorded') && (
                        <>
                            <button onClick={reset} className="text-[#444] hover:text-[#888] transition-colors p-2" title="Reset">
                                <RefreshCw size={14} />
                            </button>
                            
                            {appState === 'completed' && processedAudio && (
                                <button 
                                    onClick={() => AudioService.downloadBuffer(processedAudio, tab === 'encode' ? 'birdsong_artifact.wav' : 'recovered_speech.wav')} 
                                    className="text-amber-600 hover:text-amber-400 transition-colors flex items-center gap-2 text-[10px] font-bold tracking-wider px-4 py-1.5 bg-[#0a0a0a] border border-[#222] rounded-full"
                                >
                                    <Download size={12} />
                                    SAVE
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
            
        {/* LOGS MODAL */}
        {showHistory && (
             <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex items-end sm:items-center justify-center animate-in fade-in duration-200">
                <div className="w-full max-w-lg bg-[#0a0a0a] border-t sm:border border-[#222] sm:rounded-2xl p-6 shadow-2xl relative flex flex-col h-[85vh] sm:h-[80vh]">
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
                    
                    <div className="flex-1 overflow-y-auto min-h-0 space-y-2 pr-2 custom-scrollbar pb-safe">
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