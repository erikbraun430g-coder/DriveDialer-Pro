
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Type } from '@google/genai';
import { Contact } from '../types';

interface VoiceControllerProps {
  contacts: Contact[];
  currentIndex: number;
  setCurrentIndex: (idx: number) => void;
  onCallComplete: (id: string) => void;
}

// Handmatige base64 hulpfuncties conform richtlijnen
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

  // De cruciale 'Hard Reset' functie om hardware vrij te geven
  const hardReset = useCallback(async () => {
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
    return () => { hardReset(); };
  }, [hardReset]);

  const startAssistant = async () => {
    if (isActive || isConnecting) {
      await hardReset();
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

      const contextData = contacts.map((c, i) => 
        `Index ${i + 1}: ${c.name} (${c.relation}). Onderwerp: ${c.subject}. Telefoon: ${c.phone}`
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
              const input = e.inputBuffer.getChannelData(0);
              const pcm = new Int16Array(input.length);
              for (let i = 0; i < input.length; i++) pcm[i] = input[i] * 32768;
              const data = encode(new Uint8Array(pcm.buffer));
              
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: { data, mimeType: 'audio/pcm;rate=16000' } });
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
                if (fc.name === 'goto_item' && fc.args?.index) {
                  const idx = (fc.args.index as number) - 1;
                  if (idx >= 0 && idx < contacts.length) setCurrentIndex(idx);
                }
                if (fc.name === 'trigger_call') {
                  // Direct stoppen voor mic-vrijgave
                  await hardReset();
                  setAwaitingDial(true);
                }
                sessionPromise.then(session => {
                  session.sendToolResponse({
                    functionResponses: { id: fc.id, name: fc.name, response: { result: "ok" } }
                  });
                });
              }
            }
          },
          onerror: () => hardReset(),
          onclose: () => hardReset()
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
          tools: [{ functionDeclarations: [
            { 
              name: 'goto_item', 
              description: 'Toon een andere taak.',
              parameters: { type: Type.OBJECT, properties: { index: { type: Type.NUMBER } }, required: ['index'] } 
            },
            { 
              name: 'trigger_call', 
              description: 'Start het bellen.',
              parameters: { type: Type.OBJECT, properties: {} } 
            }
          ]}] as any,
          systemInstruction: `Je bent DriveDialer. 
          DATABASE:
          ${contextData}
          
          STRIKTE REGELS:
          1. Als de gebruiker vraagt om iemand te bellen, gebruik trigger_call.
          2. Als je naar iemand anders gaat, gebruik goto_item en zeg daarna: "[Naam] van [Bedrijf]. Onderwerp is [Onderwerp]."
          3. Wees extreem kort en zakelijk. Geen beleefdheidsvormen.`
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (e) {
      console.error(e);
      await hardReset();
    }
  };

  const cleanPhone = currentContact?.phone.replace(/[^0-9+]/g, '') || '';

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 relative select-none">
      
      {/* DRIVE MODE UI: Alleen de Naam */}
      <div className="mb-24 text-center w-full animate-in fade-in zoom-in-95 duration-700" key={currentIndex}>
        <h2 className="text-7xl sm:text-9xl font-black text-white tracking-tighter uppercase leading-[0.9] break-words">
          {currentContact?.name}
        </h2>
      </div>

      <div className="w-full max-w-sm">
        {awaitingDial ? (
          <div className="space-y-6 animate-in slide-in-from-bottom-12 duration-500">
            <a 
              href={`tel:${cleanPhone}`}
              onClick={() => {
                onCallComplete(currentContact.id);
                setAwaitingDial(false);
              }}
              className="w-full h-72 rounded-[120px] bg-green-500 text-black font-black flex flex-col items-center justify-center no-underline shadow-[0_0_150px_rgba(34,197,94,0.4)] active:scale-95 transition-all border-8 border-green-400"
            >
              <span className="text-9xl mb-2">📞</span>
              <span className="text-xs uppercase tracking-[0.5em] font-black opacity-60">BEL {currentContact?.name}</span>
            </a>
            <button 
              onClick={() => setAwaitingDial(false)} 
              className="w-full py-6 text-white/20 text-[10px] uppercase font-black tracking-[0.4em]"
            >
              Annuleren
            </button>
          </div>
        ) : (
          <button 
            onClick={startAssistant}
            disabled={isConnecting}
            className={`w-full h-72 rounded-[120px] font-black text-7xl tracking-tighter shadow-2xl transition-all duration-500 active:scale-90 border-[12px] ${
              isActive 
                ? 'bg-red-600 border-red-500 text-white animate-pulse' 
                : 'bg-blue-600 border-blue-500 text-white'
            } ${isConnecting ? 'opacity-10' : 'opacity-100'}`}
          >
            {isConnecting ? '...' : isActive ? 'STOP' : 'START'}
          </button>
        )}
      </div>

      {/* Visualizer onderaan */}
      <div className="absolute bottom-16 left-0 right-0 flex justify-center items-center gap-3 h-12 pointer-events-none">
        {isActive && !awaitingDial ? (
          [0.3, 0.7, 1.0, 0.6, 0.9].map((h, i) => (
            <div 
              key={i} 
              className="w-3 bg-blue-500 rounded-full animate-wave" 
              style={{ height: `${h * 100}%`, animationDelay: `${i * 0.1}s` }}
            ></div>
          ))
        ) : (
          <div className="h-[2px] w-24 bg-white/5 rounded-full"></div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes wave {
          0%, 100% { transform: scaleY(0.4); opacity: 0.1; }
          50% { transform: scaleY(1.8); opacity: 1; }
        }
        .animate-wave { animation: wave 0.4s ease-in-out infinite; }
      ` }} />
    </div>
  );
};

export default VoiceController;
