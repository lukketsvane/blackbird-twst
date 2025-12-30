import React from 'react';

export const Diagram = () => {
  return (
    <div className="w-full overflow-x-auto bg-[#050505] rounded-lg border border-[#333] p-6 mb-6">
      <svg viewBox="0 0 800 340" className="w-full min-w-[600px] font-mono text-xs select-none">
        <defs>
          <marker id="head-white" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
            <path d="M0,0 L0,6 L9,3 z" fill="#ffffff" />
          </marker>
          <marker id="head-gray" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
            <path d="M0,0 L0,6 L9,3 z" fill="#666666" />
          </marker>
        </defs>

        {/* --- ENCODER ROW --- */}
        <text x="30" y="30" fill="#fff" fontSize="12" fontWeight="bold" letterSpacing="1">ENCODER (AM MODULATION)</text>
        
        {/* Input */}
        <circle cx="50" cy="100" r="18" stroke="#666" strokeWidth="2" fill="#111" />
        <text x="50" y="104" textAnchor="middle" fill="#666" fontSize="8">MIC</text>

        {/* Pitch Path (Carrier) */}
        <path d="M70 100 L110 100 L110 70 L130 70" stroke="#fff" strokeWidth="1.5" fill="none" markerEnd="url(#head-white)" />
        <rect x="130" y="50" width="60" height="40" stroke="#333" strokeWidth="1" fill="#111" />
        <text x="160" y="68" textAnchor="middle" fill="#fff" fontSize="10">Pitch</text>
        <text x="160" y="82" textAnchor="middle" fill="#666" fontSize="8">Detect</text>
        
        <path d="M190 70 L220 70" stroke="#fff" strokeWidth="1.5" fill="none" markerEnd="url(#head-white)" />
        <rect x="220" y="50" width="60" height="40" stroke="#333" strokeWidth="1" fill="#111" />
        <text x="250" y="68" textAnchor="middle" fill="#fff" fontWeight="bold">Map</text>
        <text x="250" y="82" textAnchor="middle" fill="#666" fontSize="8">3k-7kHz</text>

        <path d="M280 70 L310 70" stroke="#fff" strokeWidth="1.5" fill="none" markerEnd="url(#head-white)" />
        <circle cx="330" cy="70" r="20" stroke="#333" strokeWidth="1" fill="#111" />
        <path d="M320 70 Q330 60 340 70 T360 70" stroke="#fff" strokeWidth="1.5" fill="none" transform="scale(0.5) translate(320, 70)" />
        <text x="330" y="45" textAnchor="middle" fill="#fff" fontSize="8">OSC</text>

        {/* Signal Path (Envelope) */}
        <path d="M70 100 L110 100 L110 130 L130 130" stroke="#666" strokeWidth="1.5" fill="none" markerEnd="url(#head-gray)" />
        <rect x="130" y="110" width="60" height="40" stroke="#333" strokeWidth="1" fill="#111" />
        <text x="160" y="128" textAnchor="middle" fill="#fff" fontSize="10">LPF</text>
        <text x="160" y="142" textAnchor="middle" fill="#666" fontSize="8">2.5kHz</text>

        <path d="M190 130 L260 130" stroke="#666" strokeWidth="1.5" fill="none" markerEnd="url(#head-gray)" />
        <rect x="260" y="110" width="60" height="40" stroke="#333" strokeWidth="1" fill="#111" />
        <text x="290" y="128" textAnchor="middle" fill="#fff" fontSize="10">Bias</text>
        <text x="290" y="142" textAnchor="middle" fill="#666" fontSize="8">+1.0</text>
        
        {/* Multiplication */}
        <path d="M350 70 L390 70 L390 90" stroke="#fff" strokeWidth="1.5" fill="none" markerEnd="url(#head-white)" />
        <path d="M320 130 L390 130 L390 110" stroke="#666" strokeWidth="1.5" fill="none" markerEnd="url(#head-gray)" />
        
        <circle cx="390" cy="100" r="16" stroke="#333" strokeWidth="1" fill="#111" />
        <text x="390" y="104" textAnchor="middle" fill="white" fontSize="16">×</text>
        <text x="430" y="104" textAnchor="middle" fill="#666" fontSize="9">AM</text>

        <path d="M406 100 L500 100" stroke="#fff" strokeWidth="2" strokeDasharray="4 2" fill="none" markerEnd="url(#head-white)" />
        <text x="530" y="105" textAnchor="middle" fill="#fff" fontWeight="bold">BIRDSONG</text>


        {/* --- DECODER ROW --- */}
        <text x="30" y="210" fill="#fff" fontSize="12" fontWeight="bold" letterSpacing="1">DECODER (ENVELOPE DETECT)</text>
        
        {/* Input */}
        <circle cx="50" cy="270" r="18" stroke="#fff" strokeWidth="2" fill="#111" />
        <text x="50" y="274" textAnchor="middle" fill="#fff" fontSize="8">WAV</text>

        {/* Rectification */}
        <path d="M70 270 L110 270" stroke="#fff" strokeWidth="1.5" fill="none" markerEnd="url(#head-white)" />
        <rect x="110" y="250" width="60" height="40" stroke="#333" strokeWidth="1" fill="#111" />
        <text x="140" y="268" textAnchor="middle" fill="white" fontSize="10">ABS</text>
        <text x="140" y="282" textAnchor="middle" fill="#666" fontSize="8">Rectify</text>

        {/* Filtering */}
        <path d="M170 270 L210 270" stroke="#fff" strokeWidth="1.5" fill="none" markerEnd="url(#head-white)" />
        <rect x="210" y="250" width="60" height="40" stroke="#333" strokeWidth="1" fill="#111" />
        <text x="240" y="268" textAnchor="middle" fill="white" fontSize="10">LPF</text>
        <text x="240" y="282" textAnchor="middle" fill="#666" fontSize="8">2.8kHz</text>

        {/* DC Block */}
        <path d="M270 270 L310 270" stroke="#fff" strokeWidth="1.5" fill="none" markerEnd="url(#head-white)" />
        <rect x="310" y="250" width="60" height="40" stroke="#333" strokeWidth="1" fill="#111" />
        <text x="340" y="268" textAnchor="middle" fill="white" fontSize="10">DC</text>
        <text x="340" y="282" textAnchor="middle" fill="#666" fontSize="8">Block</text>

        {/* Speaker Output */}
        <path d="M370 270 L420 270" stroke="#666" strokeWidth="1.5" fill="none" markerEnd="url(#head-gray)" />
        <path d="M420 260 L420 280 L440 290 L440 250 Z" stroke="#666" strokeWidth="2" fill="#111" />
        <text x="480" y="275" textAnchor="middle" fill="#666" fontWeight="bold">SPEECH</text>

        {/* Annotations */}
        <text x="550" y="240" fill="#444" fontSize="9">
          <tspan x="550" dy="0">This method works because the</tspan>
          <tspan x="550" dy="12">speech information is entirely</tspan>
          <tspan x="550" dy="12">contained in the amplitude</tspan>
          <tspan x="550" dy="12">envelope of the carrier.</tspan>
        </text>

      </svg>
    </div>
  );
};