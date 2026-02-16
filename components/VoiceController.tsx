
import React, { useState, useRef, useCallback } from 'react';
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
  }, []);

  const handleCallInitiated = () => {
    // Gebruiker heeft op de tel: link geklikt.
    // We wachten even zodat de systeem-dialer kan openen voor we de UI updaten.
    setTimeout(() => {
      onCallComplete(currentContact.id);
      cleanup();
    }, 2000);
  };

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

      const tableContext = contacts.map((c, i) => 
        `RIJ ${i + 1}: [NAAM: ${c.name}] [ORGANISATIE: ${c.relation}] [ONDERWERP: ${c.subject}] [TEL: ${c.phone}]`
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
              const start = Math.max(nextStartTimeRef.current, audioOutRef.current.currentTime);
              source.start(start);
              nextStartTimeRef.current = start + buffer.duration;
            }

            if (msg.toolCall?.functionCalls) {
              for (const fc of msg.toolCall.functionCalls) {
                if (fc.name === 'prepare_dial') {
                  setAwaitingClick(true);
                }
                if (fc.name === 'goto_item') {
                  const idx = (fc.args?.index as number) - 1;
                  if (idx >= 0 && idx < contacts.length) setCurrentIndex(idx);
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
              name: 'prepare_dial', 
              description: 'Zet de telefoonknop klaar voor de gebruiker.', 
              parameters: { type: Type.OBJECT, properties: {} } 
            },
            { 
              name: 'goto_item', 
              description: 'Focus op een andere rij in de lijst.', 
              parameters: { type: Type.OBJECT, properties: { index: { type: Type.NUMBER } }, required: ['index'] } 
            }
          ]}] as any,
          systemInstruction: `Je bent de DriveDialer assistent. Je bent een expert in de spreadsheet die ik je nu geef.

          SPREADSHEET DATA:
          ${tableContext}

          FOCUS NU OP: Item #${currentIndex + 1} (${currentContact?.name}).

          INSTRUCTIES:
          1. DETAILS GEVEN: Als de gebruiker vraagt: "Wat staat er bij de volgende?", "Wie is nummer 2?" of "Welk bedrijf is dit?", lees dan ALTIJD de volledige context voor: "Naam: [Naam], Bedrijf: [Organisatie], Onderwerp: [Onderwerp]".
          2. NAVIGEREN: Gebruik 'goto_item' om naar een specifiek nummer in de lijst te gaan.
          3. BELLEN: Als de gebruiker wil bellen:
             - Gebruik de 'prepare_dial' tool.
             - Zeg: "Ik heb het nummer klaargezet. Tik nu op de groene knop om het gesprek te starten."
          4. STIJL: Spreek uitsluitend Nederlands. Wees beknopt maar informatief.`
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
      
      {/* Info Sectie */}
      <div className="mb-16 text-center animate-in fade-in slide-in-from-top-4 duration-700">
        <div className="inline-block px-4 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-full mb-6">
          <span className="text-blue-500 font-black text-[10px] tracking-[0.4em] uppercase">
             Lijstpositie {currentIndex + 1} / {contacts.length}
          </span>
        </div>
        
        <h2 className={`text-5xl font-black text-white tracking-tighter uppercase mb-4 transition-all duration-500 ${awaitingClick ? 'scale-110 text-green-400' : ''}`}>
          {currentContact?.name}
        </h2>
        
        <div className="space-y-3">
          <p className="text-blue-400 text-sm font-black uppercase tracking-widest">
            {currentContact?.relation}
          </p>
          <div className="max-w-[300px] mx-auto bg-white/5 p-4 rounded-3xl border border-white/5">
            <p className="text-white/60 text-xs font-medium leading-relaxed italic">
              "{currentContact?.subject}"
            </p>
          </div>
        </div>
      </div>

      {/* De Interactieve Knop - Nu met iOS Safe Anchor */}
      <div className="relative w-full max-w-xs aspect-square flex items-center justify-center">
        {awaitingClick ? (
          <a 
            href={`tel:${cleanPhone}`}
            onClick={handleCallInitiated}
            className="relative w-full h-full rounded-[60px] bg-green-500 shadow-[0_0_50px_rgba(34,197,94,0.4)] text-black font-black text-4xl tracking-tighter flex flex-col items-center justify-center animate-in zoom-in duration-300 no-underline"
          >
            <span className="mb-2">BEL NU</span>
            <span className="text-[10px] tracking-[0.2em] opacity-60 uppercase">Tik om dialer te openen</span>
            <div className="absolute inset-0 bg-white/20 animate-ping rounded-[60px] pointer-events-none"></div>
          </a>
        ) : (
          <button 
            onClick={toggleSession}
            disabled={isConnecting}
            className={`relative w-full h-full rounded-[60px] font-black text-4xl tracking-tighter transition-all duration-500 flex flex-col items-center justify-center overflow-hidden shadow-2xl active:scale-90 ${
              isActive 
                ? 'bg-red-600 shadow-red-900/40 text-white' 
                : 'bg-blue-600 shadow-blue-900/40 text-white'
            } ${isConnecting ? 'opacity-50' : 'opacity-100'}`}
          >
            {isActive && <div className="absolute inset-0 bg-white/10 animate-pulse"></div>}
            <span>{isConnecting ? '...' : isActive ? 'STOP' : 'START'}</span>
          </button>
        )}
      </div>

      {/* Status Indicators */}
      <div className="mt-12 h-10 flex items-center justify-center gap-2">
        {isActive && !awaitingClick ? (
          [0.3, 0.8, 0.4, 1.0, 0.5, 0.9, 0.3].map((h, i) => (
            <div 
              key={i}
              className="w-1.5 bg-blue-500 rounded-full animate-wave" 
              style={{ height: `${h * 100}%`, animationDelay: `${i * 0.1}s` }}
            ></div>
          ))
        ) : awaitingClick ? (
          <div className="flex items-center gap-2">
             <div className="w-2 h-2 bg-green-500 rounded-full animate-bounce"></div>
             <div className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
             <div className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
          </div>
        ) : (
          <div className="h-[1px] w-24 bg-white/10"></div>
        )}
      </div>

      <style>{`
        @keyframes wave {
          0%, 100% { transform: scaleY(0.4); opacity: 0.5; }
          50% { transform: scaleY(1.8); opacity: 1; }
        }
        .animate-wave {
          animation: wave 0.7s ease-in-out infinite;
        }
      `}</style>

    </div>
  );
};

export default VoiceController;
