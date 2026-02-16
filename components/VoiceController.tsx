
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Type } from '@google/genai';
import { Contact } from '../types';

interface VoiceControllerProps {
  contacts: Contact[];
  currentIndex: number;
  setCurrentIndex: (idx: number) => void;
  onCallComplete: (id: string) => void;
}

const encode = (bytes: Uint8Array) => {
  let b = '';
  for (let i = 0; i < bytes.byteLength; i++) b += String.fromCharCode(bytes[i]);
  return btoa(b);
};

const decode = (base64: string) => {
  const s = atob(base64);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
};

const VoiceController: React.FC<VoiceControllerProps> = ({ contacts, currentIndex, setCurrentIndex, onCallComplete }) => {
  const [isActive, setIsActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [awaitingClick, setAwaitingClick] = useState(false);
  const [callInitiated, setCallInitiated] = useState(false);
  
  const currentContact = contacts[currentIndex];

  const sessionRef = useRef<any>(null);
  const audioInRef = useRef<AudioContext | null>(null);
  const audioOutRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);

  const cleanup = useCallback(async () => {
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch (e) {}
      sessionRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (audioInRef.current) {
      await audioInRef.current.close().catch(() => {});
      audioInRef.current = null;
    }
    if (audioOutRef.current) {
      await audioOutRef.current.close().catch(() => {});
      audioOutRef.current = null;
    }
    nextStartTimeRef.current = 0;
    setIsActive(false);
    setIsConnecting(false);
    setAwaitingClick(false);
    setCallInitiated(false);
  }, []);

  useEffect(() => {
    return () => { cleanup(); };
  }, [cleanup]);

  const toggleSession = async () => {
    if (isActive || isConnecting) {
      await cleanup();
      return;
    }

    setIsConnecting(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const inCtx = new AudioContext({ sampleRate: 16000 });
      const outCtx = new AudioContext({ sampleRate: 24000 });
      audioInRef.current = inCtx;
      audioOutRef.current = outCtx;

      // Bouw een compacte index voor de AI
      const spreadsheetMap = contacts.map((c, i) => 
        `Taak ${i + 1}: ${c.name} (${c.relation}) over: ${c.subject}`
      ).join('\n');

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setIsActive(true);
            setIsConnecting(false);
            const source = inCtx.createMediaStreamSource(stream);
            const processor = inCtx.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
              if (!sessionRef.current) return;
              const input = e.inputBuffer.getChannelData(0);
              const pcm = new Int16Array(input.length);
              for (let i = 0; i < input.length; i++) pcm[i] = input[i] * 32768;
              sessionRef.current.sendRealtimeInput({
                media: { data: encode(new Uint8Array(pcm.buffer)), mimeType: 'audio/pcm;rate=16000' }
              });
            };
            source.connect(processor);
            processor.connect(inCtx.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData && audioOutRef.current) {
              const raw = decode(audioData);
              const int16 = new Int16Array(raw.buffer);
              const buffer = audioOutRef.current.createBuffer(1, int16.length, 24000);
              const channel = buffer.getChannelData(0);
              for (let i = 0; i < int16.length; i++) channel[i] = int16[i] / 32768.0;
              const source = audioOutRef.current.createBufferSource();
              source.buffer = buffer;
              source.connect(audioOutRef.current.destination);
              const now = audioOutRef.current.currentTime;
              const startTime = Math.max(nextStartTimeRef.current, now);
              source.start(startTime);
              nextStartTimeRef.current = startTime + buffer.duration;
            }

            if (msg.toolCall?.functionCalls) {
              for (const fc of msg.toolCall.functionCalls) {
                if (!fc.args) continue; // TS Guard
                
                if (fc.name === 'goto_item') {
                  const idx = (fc.args.index as number) - 1;
                  if (idx >= 0 && idx < contacts.length) {
                    setCurrentIndex(idx);
                    setAwaitingClick(false);
                    setCallInitiated(false);
                  }
                }
                if (fc.name === 'prepare_dial') {
                  setAwaitingClick(true);
                }
                sessionRef.current?.sendToolResponse({
                  functionResponses: { id: fc.id, name: fc.name, response: { result: "ok" } }
                });
              }
            }
          },
          onerror: () => cleanup(),
          onclose: () => cleanup()
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
          tools: [{ functionDeclarations: [
            { 
              name: 'goto_item', 
              description: 'Focus de app op een specifieke taak uit de lijst.',
              parameters: { type: Type.OBJECT, properties: { index: { type: Type.NUMBER, description: 'Het taaknummer uit de spreadsheet (1-61)' } }, required: ['index'] } 
            },
            { name: 'prepare_dial', description: 'Activeer de bel-knop voor de huidige persoon.', parameters: { type: Type.OBJECT, properties: {} } }
          ]}] as any,
          systemInstruction: `Je bent DriveDialer, een stem-assistent.
          
          DATA MAP (Focus op taaknummers):
          ${spreadsheetMap}

          BELANGRIJK:
          1. Als de gebruiker vraagt naar een taak (bijv "nu taak 4"):
             - Gebruik DIRECT 'goto_item' met index 4.
             - Zeg dan de info op in deze volgorde: "[Naam], [Organisatie]. Onderwerp: [Onderwerp]."
          2. Zodra de info is opgelezen, wacht je op instructie of 'bel hem'.
          3. Gebruik 'prepare_dial' alleen als de gebruiker wil bellen.
          4. Wees extreem kort en zakelijk. Praat niet over knoppen of tools.`
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (e) {
      console.error(e);
      await cleanup();
    }
  };

  const cleanPhone = currentContact?.phone.replace(/[^0-9+]/g, '') || '';

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-4 relative">
      
      {/* Contact Header - Altijd gesynchroniseerd */}
      <div className="mb-10 text-center w-full animate-in fade-in zoom-in-95 duration-500" key={currentIndex}>
        <div className="inline-block px-4 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-full mb-6">
          <span className="text-blue-500 font-black text-[10px] tracking-[0.5em] uppercase">
             TAAK {currentIndex + 1} / {contacts.length}
          </span>
        </div>
        
        <h2 className="text-5xl font-black text-white tracking-tighter uppercase mb-2 break-words px-4">
          {currentContact?.name}
        </h2>
        
        <p className="text-blue-400 font-bold uppercase tracking-widest text-sm mb-6">
          {currentContact?.relation}
        </p>

        <div className="bg-white/5 p-8 rounded-[40px] border border-white/10 mx-auto max-w-sm shadow-inner">
          <p className="text-white/50 text-[11px] font-bold uppercase tracking-[0.2em] leading-relaxed">
            "{currentContact?.subject}"
          </p>
        </div>
      </div>

      <div className="w-full max-w-xs space-y-6">
        {awaitingClick ? (
          <>
            <a 
              href={`tel:${cleanPhone}`}
              onClick={() => setCallInitiated(true)}
              className="w-full aspect-square sm:aspect-video rounded-[60px] bg-green-500 text-black font-black flex flex-col items-center justify-center no-underline shadow-[0_0_80px_rgba(34,197,94,0.5)] active:scale-95 transition-all animate-in zoom-in-90 duration-300"
            >
              <span className="text-xs opacity-40 mb-1 uppercase tracking-widest font-black">TIK OM TE BELLEN</span>
              <span className="text-4xl tracking-tighter">{currentContact?.phone}</span>
            </a>
            
            {callInitiated && (
              <button 
                onClick={() => onCallComplete(currentContact.id)}
                className="w-full py-7 rounded-[35px] bg-blue-600 text-white font-black uppercase tracking-[0.4em] text-[10px] shadow-2xl animate-in slide-in-from-bottom-4 duration-500"
              >
                Volgende Taak
              </button>
            )}
          </>
        ) : (
          <button 
            onClick={toggleSession}
            disabled={isConnecting}
            className={`w-full aspect-square sm:aspect-video rounded-[60px] font-black text-4xl tracking-tighter shadow-2xl transition-all duration-500 active:scale-90 ${
              isActive ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'
            } ${isConnecting ? 'opacity-30' : 'opacity-100'}`}
          >
            {isConnecting ? '...' : isActive ? 'STOP' : 'START'}
          </button>
        )}
      </div>

      {/* Visualizer Footer */}
      <div className="mt-12 h-10 flex items-center gap-1.5">
        {isActive && !awaitingClick ? (
          [0.4, 0.9, 0.5, 1.0, 0.7].map((h, i) => (
            <div key={i} className="w-1.5 bg-blue-500 rounded-full animate-pulse-fast" style={{ height: `${h * 100}%`, animationDelay: `${i*0.1}s` }}></div>
          ))
        ) : (
          <div className="h-[2px] w-40 bg-white/10 rounded-full"></div>
        )}
      </div>

      <style>{`
        @keyframes pulse-fast {
          0%, 100% { transform: scaleY(0.5); opacity: 0.5; }
          50% { transform: scaleY(1.5); opacity: 1; }
        }
        .animate-pulse-fast {
          animation: pulse-fast 0.5s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
};

export default VoiceController;
