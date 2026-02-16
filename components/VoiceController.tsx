
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
  const [isDialing, setIsDialing] = useState(false);
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);
  
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
    setIsDialing(false);
    setPendingPhone(null);
  }, []);

  // De daadwerkelijke bel-functie
  const executeDial = useCallback((phone: string, id: string) => {
    const cleanPhone = phone.replace(/[^0-9+]/g, '');
    
    // Probeer direct te bellen
    window.location.assign(`tel:${cleanPhone}`);
    
    // Update de lijst status
    setTimeout(() => {
      onCallComplete(id);
      cleanup();
    }, 1500);
  }, [onCallComplete, cleanup]);

  const handleDial = useCallback((index?: number) => {
    const targetIdx = (typeof index === 'number' && index > 0) ? index - 1 : currentIndex;
    const contact = contacts[targetIdx];
    
    if (!contact) return;
    
    setIsDialing(true);
    setPendingPhone(contact.phone);
    
    // Op sommige browsers werkt dit direct, op andere is een klik nodig.
    // We proberen het direct, en tonen anders een grote knop.
    executeDial(contact.phone, contact.id);
  }, [currentIndex, contacts, executeDial]);

  const handleGoto = useCallback((index: number) => {
    const targetIdx = index - 1;
    if (targetIdx >= 0 && targetIdx < contacts.length) {
      setCurrentIndex(targetIdx);
    }
  }, [contacts.length, setCurrentIndex]);

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

      const detailedList = contacts.map((c, i) => 
        `Item ${i + 1}: Naam: ${c.name}, Organisatie: ${c.relation}, Onderwerp: ${c.subject}, Telefoon: ${c.phone}`
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
                if (fc.name === 'dial') handleDial(fc.args?.index as number);
                if (fc.name === 'goto') handleGoto(fc.args?.index as number);
                if (fc.name === 'skip') handleGoto(currentIndex + 2);
                
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
              name: 'dial', 
              description: 'Activeer de dialer om de persoon te bellen.', 
              parameters: { type: Type.OBJECT, properties: { index: { type: Type.NUMBER } } } 
            },
            { 
              name: 'goto', 
              description: 'Verspring op het scherm naar een specifiek item.', 
              parameters: { type: Type.OBJECT, properties: { index: { type: Type.NUMBER } }, required: ['index'] } 
            },
            { 
              name: 'skip', 
              description: 'Sla deze persoon over.', 
              parameters: { type: Type.OBJECT, properties: {} } 
            }
          ]}] as any,
          systemInstruction: `Je bent de intelligente DriveDialer assistent. Je hebt volledige toegang tot deze spreadsheet:

          CONTACTENLIJST:
          ${detailedList}

          HUIDIGE FOCUS: Item #${currentIndex + 1} (${currentContact?.name}).

          COMMANDO'S EN GEDRAG:
          1. VOORLEZEN: Als de gebruiker vraagt om een taak voor te lezen (bijv. "Lees taak 1 voor" of "Wie is de volgende?"):
             - Gebruik 'goto' om het item op het scherm te tonen.
             - Lees ALTIJD voor: "[Naam] van [Organisatie], te bespreken: [Onderwerp]".
             - Vraag daarna pas: "Zal ik deze persoon bellen?"
          2. DETAILS: De gebruiker kan vragen stellen over organisaties of onderwerpen. Gebruik de lijst hierboven om antwoord te geven.
          3. BELLEN: Gebruik de 'dial' tool ALLEEN als de gebruiker expliciet bevestigt (bijv. "Ja", "Bellen", "Doe maar").
          4. FEEDBACK: Zeg altijd "Ik ga [Naam] nu voor je bellen" voordat je de dialer activeert.
          5. TAAL: Spreek uitsluitend Nederlands en wees beknopt.`
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (e) {
      console.error(e);
      await cleanup();
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-4 relative">
      
      {/* Dialer Overlay voor het geval de automatische pop-up wordt geblokkeerd */}
      {isDialing && pendingPhone && (
        <div className="absolute inset-0 z-50 bg-blue-600 flex flex-col items-center justify-center p-8 animate-in fade-in zoom-in duration-300">
           <h2 className="text-white text-center font-black text-4xl uppercase tracking-tighter mb-8">
             Tik hier om te bellen
           </h2>
           <button 
             onClick={() => executeDial(pendingPhone, currentContact.id)}
             className="w-full aspect-square bg-white rounded-full flex items-center justify-center shadow-2xl active:scale-90 transition-transform"
           >
             <div className="text-blue-600 font-black text-2xl tracking-widest uppercase">BEL NU</div>
           </button>
           <button 
             onClick={() => setIsDialing(false)} 
             className="mt-12 text-white/50 font-bold uppercase tracking-widest text-[10px]"
           >
             Annuleren
           </button>
        </div>
      )}

      {/* Info Sectie */}
      <div className="mb-20 text-center">
        <div className="inline-block px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-full mb-4">
          <span className="text-blue-500 font-black text-[10px] tracking-[0.3em] uppercase">
             Taak {currentIndex + 1} van {contacts.length}
          </span>
        </div>
        <h2 className="text-4xl font-black text-white tracking-tighter uppercase mb-2">
          {currentContact?.name || "Klaar"}
        </h2>
        <div className="flex flex-col gap-1">
          <p className="text-blue-400 text-[11px] font-black uppercase tracking-[0.1em]">
            {currentContact?.relation}
          </p>
          <p className="text-white/30 text-[10px] font-medium italic">
            "{currentContact?.subject}"
          </p>
        </div>
      </div>

      {/* Grote Start/Stop Knop */}
      <button 
        onClick={toggleSession}
        disabled={isConnecting || isDialing}
        className={`relative w-full max-w-xs aspect-video rounded-[60px] font-black text-5xl tracking-[0.1em] transition-all flex items-center justify-center overflow-hidden shadow-2xl active:scale-95 ${
          isActive 
            ? 'bg-red-600 shadow-red-900/40' 
            : 'bg-blue-600 shadow-blue-900/40'
        } ${(isConnecting || isDialing) ? 'opacity-50' : 'opacity-100'}`}
      >
        {isActive && (
          <div className="absolute inset-0 bg-white/10 animate-pulse"></div>
        )}
        <span className="relative z-10">
          {isConnecting ? '...' : isActive ? 'STOP' : 'START'}
        </span>
      </button>

      {/* Visualizer */}
      <div className="mt-16 h-12 flex items-center justify-center gap-2">
        {isActive ? (
          [0.3, 0.8, 0.5, 1.0, 0.4, 0.7, 0.4].map((h, i) => (
            <div 
              key={i}
              className="w-1.5 bg-blue-500 rounded-full animate-wave" 
              style={{ height: `${h * 100}%`, animationDelay: `${i * 0.1}s` }}
            ></div>
          ))
        ) : (
          <div className="h-[2px] w-20 bg-white/5"></div>
        )}
      </div>

      <style>{`
        @keyframes wave {
          0%, 100% { transform: scaleY(0.4); opacity: 0.5; }
          50% { transform: scaleY(1.5); opacity: 1; }
        }
        .animate-wave {
          animation: wave 0.7s ease-in-out infinite;
        }
      `}</style>

    </div>
  );
};

export default VoiceController;
