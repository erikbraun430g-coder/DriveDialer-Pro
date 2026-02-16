
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

  const handleManualNext = () => {
    onCallComplete(currentContact.id);
    // De app gaat naar de volgende index via App.tsx, de re-mount doet de rest
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
        `INDEX ${i + 1}: [NAAM: ${c.name}] [BEDRIJF: ${c.relation}] [ONDERWERP: ${c.subject}]`
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
              description: 'Activeer de groene bel-knop voor de huidige persoon.', 
              parameters: { type: Type.OBJECT, properties: {} } 
            },
            { 
              name: 'goto_item', 
              description: 'Focus de app op een ander nummer in de lijst.', 
              parameters: { type: Type.OBJECT, properties: { index: { type: Type.NUMBER } }, required: ['index'] } 
            }
          ]}] as any,
          systemInstruction: `Je bent de DriveDialer rij-assistent. Je hebt toegang tot deze spreadsheet:

          SPREADSHEET INHOUD:
          ${tableContext}

          HUIDIGE STATUS: Je bent nu bij ${currentContact?.name} (Item ${currentIndex + 1}).

          JOUW TAKEN:
          1. VRAGEN OVER DE LIJST: Als de gebruiker vraagt naar details ("Wat is het onderwerp?", "Welk bedrijf is dit?"), geef dan antwoord op basis van de spreadsheet data.
          2. BELLEN: Als de gebruiker wil bellen, gebruik 'prepare_dial'. Zeg dan: "Ik heb het nummer voor ${currentContact?.name} klaargezet op de groene knop. Tik erop om te bellen."
          3. NAVIGEREN: Blijf bij de huidige persoon tot de gebruiker vraagt om de volgende ("volgende", "ga naar de volgende", "wie is nummer 3?"). Gebruik dan 'goto_item'.
          4. STIJL: Nederlands. Kort. Krachtig. Geen onnodig gepraat.`
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (e) {
      console.error(e);
      await cleanup();
    }
  };

  // Zorg voor een schoon nummer voor de tel: link
  const cleanPhone = currentContact?.phone.replace(/[^0-9+]/g, '') || '';

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-4 relative">
      
      {/* Contact Informatie - Altijd zichtbaar */}
      <div className="mb-12 text-center animate-in fade-in duration-700">
        <div className="inline-block px-4 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-full mb-6">
          <span className="text-blue-500 font-black text-[10px] tracking-[0.4em] uppercase">
             Klant {currentIndex + 1} / {contacts.length}
          </span>
        </div>
        
        <h2 className={`text-5xl font-black text-white tracking-tighter uppercase mb-4 transition-all duration-500 ${awaitingClick ? 'text-green-400 scale-110' : ''}`}>
          {currentContact?.name}
        </h2>
        
        <div className="space-y-3">
          <p className="text-blue-400 text-sm font-black uppercase tracking-widest">
            {currentContact?.relation}
          </p>
          <div className="max-w-[320px] mx-auto bg-white/5 p-6 rounded-[32px] border border-white/5">
            <p className="text-white/60 text-xs font-medium leading-relaxed italic">
              "{currentContact?.subject}"
            </p>
          </div>
        </div>
      </div>

      {/* Interactie Knoppen */}
      <div className="relative w-full max-w-xs flex flex-col items-center gap-6">
        
        {awaitingClick ? (
          <>
            {/* DE FIX: Een pure <a> tag zonder JavaScript logic in de onClick voor iOS stabiliteit */}
            <a 
              href={`tel:${cleanPhone}`}
              onClick={() => setCallInitiated(true)}
              className="w-full aspect-square sm:aspect-video rounded-[60px] bg-green-500 shadow-[0_0_60px_rgba(34,197,94,0.4)] text-black font-black text-4xl tracking-tighter flex flex-col items-center justify-center no-underline active:scale-95 transition-transform"
            >
              <span className="mb-1 uppercase">BEL NU</span>
              <span className="text-[10px] tracking-[0.2em] opacity-60 uppercase">Tik om dialer te openen</span>
            </a>

            {/* Handmatige 'Volgende' knop na de bel-klik */}
            {callInitiated && (
              <button 
                onClick={handleManualNext}
                className="w-full py-6 rounded-[40px] bg-blue-600 border border-blue-400/30 text-white font-black text-sm uppercase tracking-[0.3em] animate-in fade-in slide-in-from-bottom-4 duration-500"
              >
                Volgende Persoon
              </button>
            )}
          </>
        ) : (
          <button 
            onClick={toggleSession}
            disabled={isConnecting}
            className={`w-full aspect-square sm:aspect-video rounded-[60px] font-black text-4xl tracking-tighter transition-all duration-500 flex flex-col items-center justify-center overflow-hidden shadow-2xl active:scale-90 ${
              isActive 
                ? 'bg-red-600 shadow-red-900/40 text-white' 
                : 'bg-blue-600 shadow-blue-900/40 text-white'
            } ${isConnecting ? 'opacity-50' : 'opacity-100'}`}
          >
            {isConnecting ? '...' : isActive ? 'STOP' : 'START'}
          </button>
        )}
      </div>

      {/* Visualizer Status */}
      <div className="mt-12 h-10 flex items-center justify-center gap-2">
        {isActive && !awaitingClick ? (
          [0.3, 0.8, 0.4, 1.0, 0.6, 0.9, 0.3].map((h, i) => (
            <div 
              key={i}
              className="w-1.5 bg-blue-500 rounded-full animate-wave" 
              style={{ height: `${h * 100}%`, animationDelay: `${i * 0.1}s` }}
            ></div>
          ))
        ) : (
          <div className="h-[1px] w-32 bg-white/5 rounded-full"></div>
        )}
      </div>

      <style>{`
        @keyframes wave {
          0%, 100% { transform: scaleY(0.4); opacity: 0.5; }
          50% { transform: scaleY(1.9); opacity: 1; }
        }
        .animate-wave {
          animation: wave 0.6s ease-in-out infinite;
        }
      `}</style>

    </div>
  );
};

export default VoiceController;
