
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
  const [awaitingDial, setAwaitingDial] = useState(false);
  
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
    setAwaitingDial(false);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const inCtx = new AudioContext({ sampleRate: 16000 });
      const outCtx = new AudioContext({ sampleRate: 24000 });
      audioInRef.current = inCtx;
      audioOutRef.current = outCtx;

      const listPrompt = contacts.map((c, i) => `Taak ${i + 1}: ${c.name}, ${c.relation}. Onderwerp: ${c.subject}`).join('\n');

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
              const startTime = Math.max(nextStartTimeRef.current, audioOutRef.current.currentTime);
              source.start(startTime);
              nextStartTimeRef.current = startTime + buffer.duration;
            }

            if (msg.toolCall?.functionCalls) {
              for (const fc of msg.toolCall.functionCalls) {
                if (fc.name === 'goto_item' && fc.args) {
                  const idx = (fc.args.index as number) - 1;
                  if (idx >= 0 && idx < contacts.length) {
                    setCurrentIndex(idx);
                  }
                }
                if (fc.name === 'trigger_call') {
                  // CRITICAL: Stop AI direct om microfoon hardware vrij te geven voor het telefoongesprek
                  await cleanup();
                  setAwaitingDial(true);
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
            { name: 'goto_item', description: 'Focus de app op een specifiek taaknummer.', parameters: { type: Type.OBJECT, properties: { index: { type: Type.NUMBER } }, required: ['index'] } },
            { name: 'trigger_call', description: 'Beëindig AI sessie en toon de bel-knop.', parameters: { type: Type.OBJECT, properties: {} } }
          ]}] as any,
          systemInstruction: `Je bent de DriveDialer Assistent. 
          
          JE LIJST:
          ${listPrompt}

          INSTRUCTIES:
          1. Als de gebruiker vraagt naar een taak of persoon, gebruik 'goto_item' en zeg DIRECT: "[Naam], [Bedrijf]. Het onderwerp is [Onderwerp]."
          2. Wees extreem kort. Geen "Hallo" of "Hoe kan ik helpen".
          3. Gebruik 'trigger_call' ENKEL als de gebruiker zegt "bel hem", "bel haar" of "bel dit nummer".
          4. Noem nooit telefoonnummers hardop.`
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
    <div className="flex-1 flex flex-col items-center justify-center p-6 relative">
      
      {/* Rij-Veilige Interface: Alleen de Naam en Bedrijf */}
      <div className="mb-16 text-center w-full animate-in fade-in zoom-in-95 duration-700" key={currentIndex}>
        <div className="inline-block px-5 py-2 bg-blue-500/10 border border-blue-500/20 rounded-full mb-8">
          <span className="text-blue-500 font-black text-xs tracking-[0.4em] uppercase">
             TAAK {currentIndex + 1} / {contacts.length}
          </span>
        </div>
        
        <h2 className="text-6xl sm:text-7xl font-black text-white tracking-tighter uppercase mb-4 leading-none">
          {currentContact?.name}
        </h2>
        
        <p className="text-blue-400 font-black uppercase tracking-[0.3em] text-lg">
          {currentContact?.relation}
        </p>
      </div>

      <div className="w-full max-w-sm">
        {awaitingDial ? (
          <div className="space-y-6 animate-in slide-in-from-bottom-10 duration-500">
            <a 
              href={`tel:${cleanPhone}`}
              onClick={() => {
                onCallComplete(currentContact.id);
                setAwaitingDial(false);
              }}
              className="w-full h-48 rounded-[60px] bg-green-500 text-black font-black flex flex-col items-center justify-center no-underline shadow-[0_0_100px_rgba(34,197,94,0.5)] active:scale-95 transition-all"
            >
              <span className="text-6xl mb-2">📞</span>
              <span className="text-xs uppercase tracking-[0.5em] opacity-60">Tik om te bellen</span>
            </a>
            <button 
              onClick={() => setAwaitingDial(false)} 
              className="w-full py-6 text-white/20 text-xs uppercase font-black tracking-[0.3em]"
            >
              Annuleren
            </button>
          </div>
        ) : (
          <button 
            onClick={toggleSession}
            disabled={isConnecting}
            className={`w-full h-48 rounded-[60px] font-black text-4xl tracking-tighter shadow-2xl transition-all duration-500 active:scale-90 border-4 ${
              isActive 
                ? 'bg-red-600 border-red-500 text-white animate-pulse' 
                : 'bg-blue-600 border-blue-500 text-white'
            } ${isConnecting ? 'opacity-20' : 'opacity-100'}`}
          >
            {isConnecting ? '...' : isActive ? 'STOP' : 'START'}
          </button>
        )}
      </div>

      {/* Mic Status Visualizer (alleen als AI luistert) */}
      <div className="absolute bottom-12 left-0 right-0 flex justify-center items-center gap-2 h-12">
        {isActive && !awaitingDial ? (
          [0.3, 0.7, 1.0, 0.5, 0.8].map((h, i) => (
            <div 
              key={i} 
              className="w-2 bg-blue-500 rounded-full animate-wave" 
              style={{ height: `${h * 100}%`, animationDelay: `${i*0.1}s` }}
            ></div>
          ))
        ) : (
          <div className="h-[2px] w-24 bg-white/5 rounded-full"></div>
        )}
      </div>

      <style>{`
        @keyframes wave {
          0%, 100% { transform: scaleY(0.5); opacity: 0.3; }
          50% { transform: scaleY(1.4); opacity: 1; }
        }
        .animate-wave { animation: wave 0.5s ease-in-out infinite; }
      `}</style>
    </div>
  );
};

export default VoiceController;
